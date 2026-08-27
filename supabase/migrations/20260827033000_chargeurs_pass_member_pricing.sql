-- Chargeurs Pass member pricing for new rentals only.
-- Historical rental sessions keep their immutable pricing snapshots.

do $pricing$
declare
  v_profile_id uuid;
  v_count integer;
begin
  select count(*) into v_count
  from public.price_profiles
  where name='Chargeurs.ch Client' and active=true;
  if v_count<>1 then raise exception 'PASS_MEMBER_PRICE_PROFILE_NOT_UNIQUE'; end if;

  select id into v_profile_id
  from public.price_profiles
  where name='Chargeurs.ch Client' and active=true;

  update public.price_profiles
  set amount=0.50,
      currency='CHF',
      period_label='par 30 min',
      description='Chargeurs Pass — CHF 2 minimum, puis CHF 0.50 par 30 min (CHF 1/h).',
      initial_fee_cents=0,
      included_minutes=0,
      period_minutes=30,
      price_per_period_cents=50,
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
      priority=110,
      updated_at=now()
  where id=v_profile_id;

  delete from public.price_profile_tiers where price_profile_id=v_profile_id;

  insert into public.customer_segment_price_profiles(station_id,segment,price_profile_id,active,updated_at)
  select s.station_id,'member',v_profile_id,true,now()
  from public.stations s
  where s.station_id in ('DTA21269','DTA21277','DTA22032')
  on conflict(station_id,segment) do update set
    price_profile_id=excluded.price_profile_id,
    active=true,
    updated_at=now();
end
$pricing$;

do $assertions$
declare
  v_profile public.price_profiles%rowtype;
  v_snapshot jsonb;
  v_start timestamptz:='2026-08-27 00:00:00+00';
  v20 integer;
  v150 integer;
  v180 integer;
  v_nonreturn integer;
begin
  select * into v_profile from public.price_profiles where name='Chargeurs.ch Client' and active=true;
  if not found then raise exception 'PASS_MEMBER_PRICE_PROFILE_MISSING'; end if;

  v_snapshot:=jsonb_build_object(
    'pricing_rules_version',3,'customer_segment','member','currency','CHF',
    'initial_fee_cents',v_profile.initial_fee_cents,'period_minutes',v_profile.period_minutes,
    'price_per_period_cents',v_profile.price_per_period_cents,'included_minutes',v_profile.included_minutes,
    'grace_minutes',v_profile.grace_minutes,'daily_cap_cents',v_profile.daily_cap_cents,
    'total_cap_cents',v_profile.total_cap_cents,'max_amount_cents',v_profile.max_amount_cents,
    'min_amount_cents',v_profile.min_amount_cents,'deposit_cents',v_profile.deposit_cents,
    'unreturned_fee_cents',v_profile.unreturned_fee_cents,'unreturned_after_minutes',v_profile.unreturned_after_minutes,
    'rounding',v_profile.rounding,'tax_percent',v_profile.tax_percent,'tiered',false,'tiers','[]'::jsonb
  );

  v20:=(public.customer_wallet_pricing_state(v_snapshot,v_start,v_start+interval '20 minutes')->>'final_cents')::integer;
  v150:=(public.customer_wallet_pricing_state(v_snapshot,v_start,v_start+interval '150 minutes')->>'final_cents')::integer;
  v180:=(public.customer_wallet_pricing_state(v_snapshot,v_start,v_start+interval '180 minutes')->>'final_cents')::integer;
  v_nonreturn:=(public.customer_wallet_pricing_state(v_snapshot,v_start,v_start+interval '7200 minutes')->>'final_cents')::integer;

  if v20<>200 then raise exception 'PASS_MEMBER_PRICE_20M_%',v20; end if;
  if v150<>250 then raise exception 'PASS_MEMBER_PRICE_150M_%',v150; end if;
  if v180<>300 then raise exception 'PASS_MEMBER_PRICE_180M_%',v180; end if;
  if v_nonreturn<>3000 then raise exception 'PASS_MEMBER_NONRETURN_TOTAL_%',v_nonreturn; end if;
end
$assertions$;
