-- The customer-segment pricing snapshot uses the same immutable pricing
-- contract as the existing settlement runtime. Keep pricing_rules_version=1
-- until a version-2 settlement parser is intentionally shipped and validated.
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
as $$
declare
  r record;
  pp public.price_profiles%rowtype;
  v_start timestamptz := coalesce(p_start, now());
  v_total_min int := 0;
  v_billable_min int := 0;
  v_periods int := 0;
  v_initial int;
  v_duration int;
  v_fees int := 0;
  v_subtotal int;
  v_capped int;
  v_caps jsonb := '[]'::jsonb;
  v_days int;
  v_tax int;
  v_final int;
  v_currency text;
begin
  select * into r
  from public.resolve_customer_price_profile(p_station, p_segment)
  limit 1;
  if r.profile_id is null then raise exception 'PRICING_NOT_CONFIGURED'; end if;

  select * into pp from public.price_profiles where id = r.profile_id;
  if pp.id is null then raise exception 'PRICING_NOT_CONFIGURED'; end if;

  v_currency := coalesce(pp.currency, 'CHF');
  if p_currency is not null and upper(p_currency) <> upper(v_currency) then
    raise exception 'CURRENCY_MISMATCH';
  end if;

  if p_end is null then
    v_periods := case when pp.price_per_period_cents > 0 then 1 else 0 end;
  else
    v_total_min := greatest(0, ceil(extract(epoch from (p_end - v_start)) / 60.0)::int);
    if v_total_min <= pp.included_minutes + pp.grace_minutes then
      v_billable_min := 0;
    else
      v_billable_min := v_total_min - pp.included_minutes;
    end if;
    v_periods := case when v_billable_min > 0
      then ceil(v_billable_min::numeric / pp.period_minutes)::int else 0 end;
  end if;

  v_initial := pp.initial_fee_cents;
  v_duration := v_periods * pp.price_per_period_cents;
  if p_return_state = 'late' then v_fees := v_fees + pp.late_fee_cents; end if;
  if p_return_state = 'not_returned'
     or (pp.unreturned_after_minutes > 0 and v_total_min > pp.unreturned_after_minutes) then
    v_fees := v_fees + pp.unreturned_fee_cents;
  end if;

  v_subtotal := v_initial + v_duration + v_fees;
  v_capped := v_subtotal;
  if pp.daily_cap_cents > 0 then
    v_days := greatest(1, ceil(v_total_min::numeric / 1440)::int);
    if v_capped > pp.daily_cap_cents * v_days then
      v_capped := pp.daily_cap_cents * v_days;
      v_caps := v_caps || jsonb_build_object('type','daily','value',pp.daily_cap_cents * v_days);
    end if;
  end if;
  if pp.total_cap_cents > 0 and v_capped > pp.total_cap_cents then
    v_capped := pp.total_cap_cents;
    v_caps := v_caps || jsonb_build_object('type','total','value',pp.total_cap_cents);
  end if;
  if pp.max_amount_cents > 0 and v_capped > pp.max_amount_cents then
    v_capped := pp.max_amount_cents;
    v_caps := v_caps || jsonb_build_object('type','max','value',pp.max_amount_cents);
  end if;
  if pp.min_amount_cents > 0 and v_capped < pp.min_amount_cents then
    v_capped := pp.min_amount_cents;
    v_caps := v_caps || jsonb_build_object('type','min','value',pp.min_amount_cents);
  end if;
  if pp.rounding = 'up_5' then
    v_capped := (ceil(v_capped::numeric / 5) * 5)::int;
  elsif pp.rounding = 'up_10' then
    v_capped := (ceil(v_capped::numeric / 10) * 10)::int;
  end if;

  v_tax := round(v_capped * pp.tax_percent / 100.0)::int;
  v_final := v_capped + v_tax;

  return jsonb_build_object(
    'profile_id', pp.id,
    'profile_name', pp.name,
    'profile_version', pp.version,
    'source', r.source,
    'customer_segment', p_segment,
    'currency', v_currency,
    'start', v_start,
    'end', p_end,
    'rental_state', p_rental_state,
    'return_state', p_return_state,
    'total_minutes', v_total_min,
    'billed_periods', v_periods,
    'initial_fee_cents', v_initial,
    'duration_cents', v_duration,
    'additional_fees_cents', v_fees,
    'subtotal_cents', v_subtotal,
    'caps_applied', v_caps,
    'tax_percent', pp.tax_percent,
    'tax_cents', v_tax,
    'final_cents', v_final,
    'amount', round(v_final::numeric / 100, 2),
    'pricing_rules_version', 1,
    'included_minutes', pp.included_minutes,
    'period_minutes', pp.period_minutes,
    'price_per_period_cents', pp.price_per_period_cents,
    'grace_minutes', pp.grace_minutes,
    'daily_cap_cents', pp.daily_cap_cents,
    'total_cap_cents', pp.total_cap_cents,
    'max_amount_cents', pp.max_amount_cents,
    'deposit_cents', pp.deposit_cents,
    'late_fee_cents', pp.late_fee_cents,
    'unreturned_fee_cents', pp.unreturned_fee_cents,
    'unreturned_after_minutes', pp.unreturned_after_minutes,
    'min_amount_cents', pp.min_amount_cents,
    'rounding', pp.rounding,
    'computed_at', now()
  );
end;
$$;

revoke all on function public.compute_customer_pricing_snapshot(
  text,text,timestamptz,timestamptz,text,text,text
) from public, anon, authenticated;
grant execute on function public.compute_customer_pricing_snapshot(
  text,text,timestamptz,timestamptz,text,text,text
) to service_role;
