-- Chargeurs.ch pilot pricing rules v3.
--
-- Approved commercial policy for NEW rentals only:
-- - Express/guest tiers remain 1.90 / 3.90 / 5.90 / 7.90 CHF.
-- - Member/prepaid: CHF 1.00 for the first 30 minutes, then +CHF 0.40
--   per started additional 30 minutes, capped at CHF 5.90 per 24h period.
-- - Guarantee reference: CHF 30.00.
-- - At 72 hours without return, the contractual TOTAL becomes CHF 30.00.
--
-- Existing rental_sessions are never rewritten. Their immutable pricing_snapshot
-- keeps pricing_rules_version 1 or 2 and is settled with its historical rules.

do $preflight$
declare
  v_premium_count integer;
  v_member_count integer;
begin
  select count(*) into v_premium_count
  from public.price_profiles
  where name = 'chargeur.ch Premium' and active = true;

  select count(*) into v_member_count
  from public.price_profiles
  where name = 'Chargeurs.ch Client' and active = true;

  if v_premium_count <> 1 then
    raise exception 'PILOT_PRICING_V3_PREMIUM_PROFILE_COUNT_%', v_premium_count;
  end if;
  if v_member_count <> 1 then
    raise exception 'PILOT_PRICING_V3_MEMBER_PROFILE_COUNT_%', v_member_count;
  end if;
end
$preflight$;

-- Express ordinary tiers are intentionally untouched.
update public.price_profiles
set deposit_cents = 3000,
    unreturned_fee_cents = 3000,
    unreturned_after_minutes = 4320,
    total_cap_cents = 3000,
    max_amount_cents = 3000,
    tax_percent = 0,
    updated_at = now()
where name = 'chargeur.ch Premium'
  and active = true;

-- Member/prepaid formula. The 60-cent technical base is not a customer-facing
-- fee: 60 + first 40-cent period = CHF 1.00 for the first 30 minutes, then each
-- additional started 30-minute period adds CHF 0.40. min_amount_cents protects
-- the CHF 1.00 floor at zero/edge timestamps.
update public.price_profiles
set initial_fee_cents = 60,
    included_minutes = 0,
    period_minutes = 30,
    price_per_period_cents = 40,
    grace_minutes = 0,
    daily_cap_cents = 590,
    total_cap_cents = 3000,
    max_amount_cents = 3000,
    deposit_cents = 3000,
    late_fee_cents = 0,
    unreturned_fee_cents = 3000,
    unreturned_after_minutes = 4320,
    min_amount_cents = 100,
    rounding = 'none',
    tax_percent = 0,
    updated_at = now()
where name = 'Chargeurs.ch Client'
  and active = true;

-- New customer snapshots use v3. compute_profile_pricing remains the ordinary
-- profile engine; this wrapper normalizes a v3 non-return into a contractual
-- TARGET TOTAL. This prevents the 72h amount from depending on preceding
-- duration arithmetic or ordinary caps.
create or replace function public.compute_customer_pricing_snapshot(
  p_station text,
  p_segment text,
  p_start timestamptz,
  p_end timestamptz,
  p_rental_state text,
  p_return_state text,
  p_currency text
)
returns jsonb
language plpgsql
stable
set search_path = public
as $function$
declare
  r record;
  v_snapshot jsonb;
  v_total_min integer := 0;
  v_non_return boolean := false;
  v_target integer := 0;
  v_base integer := 0;
  v_additional integer := 0;
begin
  select * into r
  from public.resolve_customer_price_profile(p_station, p_segment)
  limit 1;

  if r.profile_id is null then
    raise exception 'PRICING_NOT_CONFIGURED';
  end if;

  v_snapshot := public.compute_profile_pricing(
    r.profile_id,
    p_start,
    p_end,
    p_rental_state,
    p_return_state,
    p_currency
  );

  if p_end is not null and p_start is not null then
    v_total_min := greatest(0, ceil(extract(epoch from (p_end - p_start)) / 60.0)::integer);
  end if;

  v_non_return := p_return_state = 'not_returned'
    or (
      p_end is not null
      and coalesce(nullif(v_snapshot->>'unreturned_after_minutes', '')::integer, 0) > 0
      and v_total_min >= coalesce(nullif(v_snapshot->>'unreturned_after_minutes', '')::integer, 0)
    );

  if v_non_return then
    v_target := coalesce(nullif(v_snapshot->>'unreturned_fee_cents', '')::integer, 0);
    if v_target <= 0 then
      raise exception 'PRICING_V3_NON_RETURN_TOTAL_NOT_CONFIGURED';
    end if;
    v_base := coalesce(nullif(v_snapshot->>'initial_fee_cents', '')::integer, 0)
      + coalesce(nullif(v_snapshot->>'duration_cents', '')::integer, 0);
    v_additional := greatest(0, v_target - v_base);

    v_snapshot := v_snapshot || jsonb_build_object(
      'additional_fees_cents', v_additional,
      'subtotal_cents', v_base + v_additional,
      'caps_applied', jsonb_build_array(jsonb_build_object('type', 'non_return_total', 'value', v_target)),
      'tax_cents', 0,
      'final_cents', v_target,
      'amount', round(v_target::numeric / 100, 2),
      'non_return_total_applied', true
    );
  else
    v_snapshot := v_snapshot || jsonb_build_object('non_return_total_applied', false);
  end if;

  return v_snapshot || jsonb_build_object(
    'source', r.source,
    'customer_segment', p_segment,
    'pricing_rules_version', 3
  );
end;
$function$;

-- Live Wallet pricing is snapshot-only. v1/v2 behavior remains unchanged; only
-- a v3 snapshot can activate the target-total non-return branch.
create or replace function public.customer_wallet_pricing_state(
  p_snapshot jsonb,
  p_start timestamptz,
  p_at timestamptz default now()
)
returns jsonb
language plpgsql
stable
set search_path = public
as $function$
declare
  v_at timestamptz := coalesce(p_at, now());
  v_total_min integer := 0;
  v_billable_min integer := 0;
  v_periods integer := 0;
  v_initial integer := 0;
  v_duration integer := 0;
  v_subtotal integer := 0;
  v_capped integer := 0;
  v_final integer := 0;
  v_tax integer := 0;
  v_days integer := 1;
  v_tiered boolean := false;
  v_tiers jsonb := '[]'::jsonb;
  v_upper integer;
  v_last_upper integer := 0;
  v_last_total integer := 0;
  v_period_minutes integer := 0;
  v_price_per_period integer := 0;
  v_included integer := 0;
  v_grace integer := 0;
  v_daily_cap integer := 0;
  v_total_cap integer := 0;
  v_max_amount integer := 0;
  v_min_amount integer := 0;
  v_tax_percent numeric := 0;
  v_rounding text := 'none';
  v_cap_reached boolean := false;
  v_currency text := 'CHF';
  v_rules_version integer := 1;
  v_unreturned_total integer := 0;
  v_unreturned_after integer := 0;
  v_non_return_total_applied boolean := false;
begin
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' or p_start is null then
    return null;
  end if;

  v_total_min := greatest(0, ceil(extract(epoch from (greatest(v_at, p_start) - p_start)) / 60.0)::integer);
  v_rules_version := coalesce(nullif(p_snapshot->>'pricing_rules_version', '')::integer, 1);
  v_initial := coalesce(nullif(p_snapshot->>'initial_fee_cents', '')::integer, 0);
  v_period_minutes := coalesce(nullif(p_snapshot->>'period_minutes', '')::integer, 0);
  v_price_per_period := coalesce(nullif(p_snapshot->>'price_per_period_cents', '')::integer, 0);
  v_included := coalesce(nullif(p_snapshot->>'included_minutes', '')::integer, 0);
  v_grace := coalesce(nullif(p_snapshot->>'grace_minutes', '')::integer, 0);
  v_daily_cap := coalesce(nullif(p_snapshot->>'daily_cap_cents', '')::integer, 0);
  v_total_cap := coalesce(nullif(p_snapshot->>'total_cap_cents', '')::integer, 0);
  v_max_amount := coalesce(nullif(p_snapshot->>'max_amount_cents', '')::integer, 0);
  v_min_amount := coalesce(nullif(p_snapshot->>'min_amount_cents', '')::integer, 0);
  v_tax_percent := coalesce(nullif(p_snapshot->>'tax_percent', '')::numeric, 0);
  v_rounding := coalesce(nullif(p_snapshot->>'rounding', ''), 'none');
  v_currency := upper(coalesce(nullif(p_snapshot->>'currency', ''), 'CHF'));
  v_unreturned_total := coalesce(nullif(p_snapshot->>'unreturned_fee_cents', '')::integer, 0);
  v_unreturned_after := coalesce(nullif(p_snapshot->>'unreturned_after_minutes', '')::integer, 0);
  v_tiers := case when jsonb_typeof(p_snapshot->'tiers') = 'array' then p_snapshot->'tiers' else '[]'::jsonb end;
  v_tiered := coalesce(nullif(p_snapshot->>'tiered', '')::boolean, jsonb_array_length(v_tiers) > 0);

  if v_tiered then
    select (t->>'upper_minutes')::integer, (t->>'total_cents')::integer
      into v_upper, v_duration
    from jsonb_array_elements(v_tiers) t
    where coalesce(t->>'upper_minutes', '') ~ '^[0-9]+$'
      and coalesce(t->>'total_cents', '') ~ '^[0-9]+$'
      and (t->>'upper_minutes')::integer >= greatest(v_total_min, 1)
    order by (t->>'upper_minutes')::integer asc
    limit 1;

    if v_duration is null then
      select (t->>'upper_minutes')::integer, (t->>'total_cents')::integer
        into v_last_upper, v_last_total
      from jsonb_array_elements(v_tiers) t
      where coalesce(t->>'upper_minutes', '') ~ '^[0-9]+$'
        and coalesce(t->>'total_cents', '') ~ '^[0-9]+$'
      order by (t->>'upper_minutes')::integer desc
      limit 1;

      if v_period_minutes <= 0 or v_price_per_period < 0 then return null; end if;
      v_periods := ceil(greatest(v_total_min - v_last_upper, 0)::numeric / v_period_minutes)::integer;
      v_duration := v_last_total + (v_periods * v_price_per_period);
    end if;
  else
    if v_total_min = 0 then
      v_periods := case when v_price_per_period > 0 then greatest(1, coalesce(nullif(p_snapshot->>'billed_periods', '')::integer, 1)) else 0 end;
    elsif v_total_min <= v_included + v_grace then
      v_periods := 0;
    else
      v_billable_min := v_total_min - v_included;
      if v_period_minutes <= 0 then return null; end if;
      v_periods := ceil(v_billable_min::numeric / v_period_minutes)::integer;
    end if;
    v_duration := v_periods * v_price_per_period;
  end if;

  v_subtotal := v_initial + coalesce(v_duration, 0);
  v_capped := v_subtotal;

  if v_rules_version = 3 and v_unreturned_after > 0 and v_total_min >= v_unreturned_after then
    if v_unreturned_total <= 0 then return null; end if;
    v_capped := v_unreturned_total;
    v_non_return_total_applied := true;
  else
    if v_daily_cap > 0 and not v_tiered then
      v_days := greatest(1, ceil(v_total_min::numeric / 1440)::integer);
      if v_capped > v_daily_cap * v_days then
        v_capped := v_daily_cap * v_days;
        v_cap_reached := true;
      end if;
    end if;
    if v_total_cap > 0 and v_capped > v_total_cap then v_capped := v_total_cap; v_cap_reached := true; end if;
    if v_min_amount > 0 and v_capped < v_min_amount then v_capped := v_min_amount; end if;
  end if;

  if v_max_amount > 0 and v_capped > v_max_amount then v_capped := v_max_amount; v_cap_reached := true; end if;

  if v_rounding = 'up_5' then v_capped := (ceil(v_capped::numeric / 5) * 5)::integer;
  elsif v_rounding = 'up_10' then v_capped := (ceil(v_capped::numeric / 10) * 10)::integer;
  end if;

  v_tax := round(v_capped * v_tax_percent / 100.0)::integer;
  v_final := v_capped + v_tax;

  return jsonb_build_object(
    'final_cents', v_final,
    'currency', v_currency,
    'total_minutes', v_total_min,
    'billed_periods', v_periods,
    'cap_reached', v_cap_reached,
    'tiered', v_tiered,
    'pricing_rules_version', v_rules_version,
    'non_return_total_applied', v_non_return_total_applied
  );
exception
  when others then
    return null;
end;
$function$;

-- Assertions: approved ordinary Express tiers stay untouched, member formula is
-- represented exactly, and all three pilot stations resolve both segments.
do $assertions$
declare
  v_premium uuid;
  v_member uuid;
  v_bad integer;
  v_snapshot jsonb;
begin
  select id into v_premium from public.price_profiles where name = 'chargeur.ch Premium' and active = true;
  select id into v_member from public.price_profiles where name = 'Chargeurs.ch Client' and active = true;

  if not exists (
    select 1 from public.price_profiles
    where id = v_member
      and initial_fee_cents = 60
      and included_minutes = 0
      and period_minutes = 30
      and price_per_period_cents = 40
      and daily_cap_cents = 590
      and min_amount_cents = 100
      and deposit_cents = 3000
      and unreturned_fee_cents = 3000
      and unreturned_after_minutes = 4320
      and total_cap_cents = 3000
      and max_amount_cents = 3000
      and tax_percent = 0
  ) then raise exception 'PILOT_PRICING_V3_MEMBER_ASSERTION_FAILED'; end if;

  if not exists (
    select 1 from public.price_profiles
    where id = v_premium
      and deposit_cents = 3000
      and unreturned_fee_cents = 3000
      and unreturned_after_minutes = 4320
      and total_cap_cents = 3000
      and max_amount_cents = 3000
      and tax_percent = 0
  ) then raise exception 'PILOT_PRICING_V3_EXPRESS_ASSERTION_FAILED'; end if;

  select count(*) into v_bad
  from (values (30,190),(120,390),(360,590),(1440,790)) expected(upper_minutes,total_cents)
  left join (
    select upper_minutes,total_cents
    from public.price_profile_tiers
    where price_profile_id = v_premium
  ) t
    on t.upper_minutes = expected.upper_minutes
   and t.total_cents = expected.total_cents
  where t.upper_minutes is null;
  if v_bad <> 0 or (select count(*) from public.price_profile_tiers where price_profile_id = v_premium) <> 4 then
    raise exception 'PILOT_PRICING_V3_EXPRESS_TIERS_CHANGED';
  end if;

  select count(*) into v_bad
  from (values ('DTA21269'),('DTA21277'),('DTA22032')) s(station_id)
  cross join (values ('guest'),('member')) seg(segment)
  left join public.customer_segment_price_profiles m
    on m.station_id = s.station_id and m.segment = seg.segment and m.active = true
  where m.price_profile_id is null
     or (seg.segment = 'guest' and m.price_profile_id <> v_premium)
     or (seg.segment = 'member' and m.price_profile_id <> v_member);
  if v_bad <> 0 then raise exception 'PILOT_PRICING_V3_SEGMENT_MAPPING_ASSERTION_FAILED'; end if;

  v_snapshot := public.compute_customer_pricing_snapshot(
    'DTA21269', 'member', now(), null, 'created', 'normal', 'CHF'
  );
  if coalesce((v_snapshot->>'pricing_rules_version')::integer, 0) <> 3 then
    raise exception 'PILOT_PRICING_V3_SNAPSHOT_VERSION_ASSERTION_FAILED';
  end if;
end
$assertions$;
