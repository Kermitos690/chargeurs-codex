-- Canonical Chargeurs Pass member pricing for new rental snapshots only.
-- Existing rental_sessions keep their immutable pricing_snapshot.
-- CHF 2 for the first started hour, then +CHF 1 per additional started hour.
-- Maximum liability / wallet reservation: CHF 30. Non-return total: CHF 30
-- after five days (pricing_rules_version=3 interprets unreturned_fee_cents as
-- the fixed non-return total).

do $migration$
declare
  v_profile_id uuid;
  v_count integer;
  v_state jsonb;
begin
  select id into v_profile_id
  from public.price_profiles
  where name='Chargeurs.ch Client' and active
  order by priority desc,updated_at desc
  limit 1;
  if v_profile_id is null then raise exception 'PASS_MEMBER_PRICE_PROFILE_NOT_FOUND'; end if;

  update public.price_profiles set
    amount=1.00,
    currency='CHF',
    period_label='par heure',
    description='Chargeurs Pass: CHF 2 la première heure, puis CHF 1 par heure entamée. Réserve/plafond CHF 30.',
    initial_fee_cents=100,
    included_minutes=0,
    period_minutes=60,
    price_per_period_cents=100,
    grace_minutes=0,
    daily_cap_cents=0,
    total_cap_cents=3000,
    max_amount_cents=3000,
    deposit_cents=3000,
    late_fee_cents=0,
    unreturned_fee_cents=3000,
    unreturned_after_minutes=7200,
    min_amount_cents=200,
    rounding='none',
    tax_percent=0,
    updated_at=now()
  where id=v_profile_id;

  -- This profile is non-tiered: the hourly formula is authoritative.
  delete from public.price_profile_tiers where price_profile_id=v_profile_id;

  update public.customer_segment_price_profiles
  set price_profile_id=v_profile_id,active=true,updated_at=now()
  where station_id in ('DTA21269','DTA21277','DTA22032') and segment='member';

  select count(*) into v_count from public.customer_segment_price_profiles
  where station_id in ('DTA21269','DTA21277','DTA22032')
    and segment='member' and active and price_profile_id=v_profile_id;
  if v_count<>3 then raise exception 'PASS_MEMBER_STATION_ASSIGNMENT_COUNT_%',v_count; end if;

  v_state:=public.customer_wallet_pricing_state(
    jsonb_build_object(
      'pricing_rules_version',3,'customer_segment','member','currency','CHF',
      'initial_fee_cents',100,'included_minutes',0,'period_minutes',60,
      'price_per_period_cents',100,'grace_minutes',0,'daily_cap_cents',0,
      'total_cap_cents',3000,'max_amount_cents',3000,'deposit_cents',3000,
      'unreturned_fee_cents',3000,'unreturned_after_minutes',7200,
      'min_amount_cents',200,'rounding','none','tax_percent',0,'tiered',false,'tiers','[]'::jsonb
    ),
    '2026-08-27 00:00:00+00'::timestamptz,
    '2026-08-27 01:00:00+00'::timestamptz
  );
  if coalesce((v_state->>'final_cents')::integer,-1)<>200 then raise exception 'PASS_MEMBER_1H_ASSERTION_%',v_state; end if;

  v_state:=public.customer_wallet_pricing_state(
    jsonb_build_object(
      'pricing_rules_version',3,'customer_segment','member','currency','CHF',
      'initial_fee_cents',100,'included_minutes',0,'period_minutes',60,
      'price_per_period_cents',100,'grace_minutes',0,'daily_cap_cents',0,
      'total_cap_cents',3000,'max_amount_cents',3000,'deposit_cents',3000,
      'unreturned_fee_cents',3000,'unreturned_after_minutes',7200,
      'min_amount_cents',200,'rounding','none','tax_percent',0,'tiered',false,'tiers','[]'::jsonb
    ),
    '2026-08-27 00:00:00+00'::timestamptz,
    '2026-08-27 02:00:00+00'::timestamptz
  );
  if coalesce((v_state->>'final_cents')::integer,-1)<>300 then raise exception 'PASS_MEMBER_2H_ASSERTION_%',v_state; end if;

  v_state:=public.customer_wallet_pricing_state(
    jsonb_build_object(
      'pricing_rules_version',3,'customer_segment','member','currency','CHF',
      'initial_fee_cents',100,'included_minutes',0,'period_minutes',60,
      'price_per_period_cents',100,'grace_minutes',0,'daily_cap_cents',0,
      'total_cap_cents',3000,'max_amount_cents',3000,'deposit_cents',3000,
      'unreturned_fee_cents',3000,'unreturned_after_minutes',7200,
      'min_amount_cents',200,'rounding','none','tax_percent',0,'tiered',false,'tiers','[]'::jsonb
    ),
    '2026-08-27 00:00:00+00'::timestamptz,
    '2026-09-01 00:00:00+00'::timestamptz
  );
  if coalesce((v_state->>'final_cents')::integer,-1)<>3000
     or coalesce((v_state->>'non_return_total_applied')::boolean,false) is not true then
    raise exception 'PASS_MEMBER_5D_NONRETURN_ASSERTION_%',v_state;
  end if;
end
$migration$;
