-- Chargeurs Pass member pricing + wallet-backed prepaid rental rail.
-- Historical rental snapshots remain immutable. This only affects new member
-- quotes and future membership_prepaid authorizations.

do $pricing$
declare
  v_profile_id uuid;
  v_count integer;
begin
  select count(*),min(id) into v_count,v_profile_id
  from public.price_profiles
  where name='Chargeurs.ch Client' and active=true;
  if v_count<>1 or v_profile_id is null then
    raise exception 'PASS_MEMBER_PRICE_PROFILE_NOT_UNIQUE';
  end if;

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

create or replace function public.authorize_member_prepaid_rental(
  p_rental_id uuid,
  p_kiosk_device_id uuid,
  p_correlation_id uuid default null
)
returns table(
  authorized boolean,
  reason text,
  reserved_cents bigint,
  currency text
)
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_session public.rental_sessions%rowtype;
  v_snapshot jsonb;
  v_orch public.rental_orchestrator_snapshots%rowtype;
  v_wallet public.wallets%rowtype;
  v_existing_reservation public.wallet_rental_reservations%rowtype;
  v_hold record;
  v_balance integer:=0;
  v_rail text;
  v_now timestamptz:=now();
  v_terms constant text:='terms-2026-08-26-preproduction-v2';
  v_privacy constant text:='privacy-2026-08-26-preproduction-v2';
  v_required constant integer:=3000;
begin
  select * into v_session
  from public.rental_sessions
  where id=p_rental_id
  for update;
  if not found then raise exception 'RENTAL_NOT_FOUND'; end if;

  if v_session.kiosk_device_id is distinct from p_kiosk_device_id then raise exception 'KIOSK_DEVICE_MISMATCH'; end if;
  if v_session.expires_at is not null and v_session.expires_at<=v_now then raise exception 'SESSION_EXPIRED'; end if;
  if v_session.customer_segment<>'member' or v_session.customer_user_id is null then
    return query select false,'NOT_MEMBER'::text,0::bigint,'CHF'::text;
    return;
  end if;
  if v_session.contract_terms_version is distinct from v_terms
     or v_session.contract_privacy_version is distinct from v_privacy
     or v_session.contract_accepted_at is null then raise exception 'CONTRACT_ACCEPTANCE_REQUIRED'; end if;

  v_snapshot:=v_session.pricing_snapshot;
  if v_snapshot is null
     or coalesce((v_snapshot->>'pricing_rules_version')::integer,0)<>3
     or coalesce(v_snapshot->>'customer_segment','')<>'member'
     or upper(coalesce(v_snapshot->>'currency',''))<>'CHF'
     or coalesce((v_snapshot->>'deposit_cents')::integer,0)<>v_required
     or coalesce((v_snapshot->>'unreturned_fee_cents')::integer,0)<>3000
     or coalesce((v_snapshot->>'unreturned_after_minutes')::integer,0)<>7200
     or coalesce((v_snapshot->>'max_amount_cents')::integer,0)<>3000
     or coalesce((v_snapshot->>'min_amount_cents')::integer,0)<>200
     or coalesce((v_snapshot->>'period_minutes')::integer,0)<>30
     or coalesce((v_snapshot->>'price_per_period_cents')::integer,0)<>50 then
    raise exception 'PASS_MEMBER_WALLET_PRICING_SNAPSHOT_REQUIRED';
  end if;

  select * into v_existing_reservation
  from public.wallet_rental_reservations
  where rental_session_id=p_rental_id
  for update;
  if found then
    if v_existing_reservation.user_id is distinct from v_session.customer_user_id
       or v_existing_reservation.held_cents<>v_required then raise exception 'PASS_WALLET_RESERVATION_CONFLICT'; end if;
    if v_existing_reservation.status='reserved'
       and v_session.settlement_strategy='membership_prepaid'
       and v_session.settlement_status='prepaid' then
      return query select true,'ALREADY_AUTHORIZED'::text,v_required::bigint,'CHF'::text;
      return;
    end if;
    raise exception 'PASS_WALLET_RESERVATION_NOT_AUTHORIZABLE';
  end if;

  if v_session.paid_at is not null
     or v_session.stripe_checkout_session_id is not null
     or v_session.stripe_payment_intent_id is not null then raise exception 'PAYMENT_ALREADY_STARTED'; end if;
  if v_session.state not in ('created','payment_pending') then raise exception 'SESSION_NOT_PREPAID_AUTHORIZABLE'; end if;

  select * into v_wallet
  from public.wallets
  where user_id=v_session.customer_user_id and currency='CHF'
  for update;
  if not found then
    return query select false,'INSUFFICIENT_PREPAID_BALANCE'::text,0::bigint,'CHF'::text;
    return;
  end if;

  select coalesce(l.balance_after_cents,0) into v_balance
  from public.wallet_ledger l
  where l.wallet_id=v_wallet.id
  order by l.created_at desc,l.id desc
  limit 1;
  v_balance:=coalesce(v_balance,0);
  if v_balance<v_required then
    return query select false,'INSUFFICIENT_PREPAID_BALANCE'::text,0::bigint,'CHF'::text;
    return;
  end if;

  v_rail:=public.claim_rental_payment_rail(
    p_rental_id,'membership_prepaid',p_correlation_id,
    jsonb_build_object('source','chargeurs_pass_wallet','required_cents',v_required)
  );
  if v_rail<>'PREPAID' then raise exception 'MEMBER_PREPAID_RAIL_CLAIM_FAILED'; end if;

  select * into v_hold
  from public.append_wallet_entry_server(
    v_session.customer_user_id,-v_required,'hold',
    'pass_rental_hold:'||p_rental_id::text,
    'reservation','rental',p_rental_id::text,null,null,p_rental_id,null,
    'Réserve location Chargeurs Pass',
    jsonb_build_object('correlation_id',p_correlation_id)
  );

  insert into public.wallet_rental_reservations(
    rental_session_id,wallet_id,user_id,currency,held_cents,status
  ) values(
    p_rental_id,v_wallet.id,v_session.customer_user_id,'CHF',v_required,'reserved'
  );

  select * into v_orch
  from public.rental_orchestrator_snapshots
  where rental_id=p_rental_id
  for update;
  if not found then raise exception 'ORCHESTRATOR_SNAPSHOT_MISSING'; end if;

  if v_orch.state='created' then
    select * into v_orch
    from public.append_rental_orchestrator_event(
      p_rental_id,v_orch.version,'payment_started',
      format('payment_started:membership_prepaid:%s',p_rental_id),v_now,
      jsonb_build_object('source','chargeurs_pass_wallet','reserved_cents',v_required),
      'payment_pending',null,v_session.station_id,v_session.battery_id,null,null
    );
  end if;
  if v_orch.state<>'payment_pending' then raise exception 'ORCHESTRATOR_NOT_PAYMENT_PENDING'; end if;

  select * into v_orch
  from public.append_rental_orchestrator_event(
    p_rental_id,v_orch.version,'payment_authorized',
    format('payment_authorized:membership_prepaid:%s',p_rental_id),v_now,
    jsonb_build_object(
      'source','chargeurs_pass_wallet','reserved_cents',v_required,
      'wallet_hold_entry_id',v_hold.entry_id,'currency','CHF','stripe_side_effect',false
    ),
    'authorized',null,v_session.station_id,v_session.battery_id,null,null
  );

  update public.rental_sessions
  set state='payment_succeeded',
      settlement_strategy='membership_prepaid',
      settlement_status='prepaid',
      settlement_error=null,
      paid_at=v_now,
      amount_paid=0,
      captured_amount_cents=0,
      refunded_amount_cents=0,
      supplemental_amount_cents=0,
      updated_at=v_now
  where id=p_rental_id;

  insert into public.payments(
    rental_session_id,provider,amount,currency,payment_method,status,
    settlement_strategy,amount_authorized_cents,amount_captured_cents,amount_refunded_cents
  ) values(
    p_rental_id,'chargeurs_wallet',0,'CHF','prepaid_balance','authorized',
    'membership_prepaid',v_required,0,0
  )
  on conflict(rental_session_id) where provider='chargeurs_wallet'
  do update set
    status='authorized',settlement_strategy='membership_prepaid',amount_authorized_cents=v_required;

  insert into public.audit_logs(action,target,data)
  values(
    'chargeurs_pass_wallet.rental_authorized',p_rental_id::text,
    jsonb_build_object(
      'reserved_cents',v_required,'currency','CHF','wallet_id',v_wallet.id,
      'wallet_hold_entry_id',v_hold.entry_id,'pricing_rules_version',3,
      'stripe_side_effect',false,'correlation_id',p_correlation_id
    )
  );

  return query select true,'AUTHORIZED'::text,v_required::bigint,'CHF'::text;
end;
$function$;
revoke all on function public.authorize_member_prepaid_rental(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.authorize_member_prepaid_rental(uuid,uuid,uuid) to service_role;

create or replace function public.settle_member_prepaid_on_return()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_pricing jsonb;
  v_final integer;
  v_orch public.rental_orchestrator_snapshots%rowtype;
  v_reservation public.wallet_rental_reservations%rowtype;
  v_release record;
  v_debit record;
  v_allocated integer:=0;
  v_now timestamptz:=now();
  v_snapshot jsonb;
begin
  if old.returned_at is not null
     or new.returned_at is null
     or new.settlement_strategy<>'membership_prepaid'
     or new.settlement_status<>'prepaid' then return new; end if;

  v_snapshot:=new.pricing_snapshot;
  if v_snapshot is null
     or coalesce((v_snapshot->>'pricing_rules_version')::integer,0)<>3
     or coalesce(v_snapshot->>'customer_segment','')<>'member'
     or coalesce((v_snapshot->>'min_amount_cents')::integer,0)<>200
     or coalesce((v_snapshot->>'period_minutes')::integer,0)<>30
     or coalesce((v_snapshot->>'price_per_period_cents')::integer,0)<>50 then
    raise exception 'PASS_MEMBER_WALLET_PRICING_SNAPSHOT_REQUIRED';
  end if;

  select * into v_reservation
  from public.wallet_rental_reservations
  where rental_session_id=new.id
  for update;
  if not found or v_reservation.status<>'reserved' or v_reservation.held_cents<>3000 then
    raise exception 'PASS_WALLET_RESERVATION_REQUIRED';
  end if;

  v_pricing:=public.customer_wallet_pricing_state(
    v_snapshot,coalesce(new.started_at,new.ejected_at,new.created_at),new.returned_at
  );
  if v_pricing is null then raise exception 'PASS_MEMBER_WALLET_PRICING_FAILED'; end if;
  v_final:=coalesce((v_pricing->>'final_cents')::integer,-1);
  if v_final<0 or v_final>v_reservation.held_cents then raise exception 'PASS_MEMBER_WALLET_FINAL_AMOUNT_INVALID'; end if;

  select * into v_release
  from public.append_wallet_entry_server(
    new.customer_user_id,v_reservation.held_cents,'release',
    'pass_rental_release:'||new.id::text,
    'reservation','rental',new.id::text,null,null,new.id,null,
    'Libération réserve location Chargeurs Pass',
    jsonb_build_object('final_cents',v_final)
  );

  if v_final>0 then
    select * into v_debit
    from public.append_wallet_entry_server(
      new.customer_user_id,-v_final,'debit',
      'pass_rental_debit:'||new.id::text,
      'other','rental',new.id::text,null,null,new.id,null,
      'Location Chargeurs Pass',
      jsonb_build_object('final_cents',v_final,'returned_at',new.returned_at)
    );
    v_allocated:=public.allocate_wallet_debit_server(v_debit.entry_id);
    if v_allocated<>v_final then raise exception 'PASS_WALLET_ALLOCATION_MISMATCH'; end if;
  end if;

  update public.wallet_rental_reservations
  set final_cents=v_final,status='settled',settled_at=v_now,released_at=v_now
  where rental_session_id=new.id;

  select * into v_orch
  from public.rental_orchestrator_snapshots
  where rental_id=new.id
  for update;
  if not found then raise exception 'ORCHESTRATOR_SNAPSHOT_MISSING'; end if;
  if v_orch.state<>'return_detected' then raise exception 'ORCHESTRATOR_NOT_RETURN_DETECTED'; end if;

  select * into v_orch
  from public.append_rental_orchestrator_event(
    new.id,v_orch.version,'pricing_finalized',
    format('pricing_finalized:membership_prepaid:%s',new.id),new.returned_at,
    jsonb_build_object(
      'source','chargeurs_pass_wallet','finalAmountCents',v_final,
      'pricingSnapshot',v_snapshot||v_pricing
    ),
    'pricing_finalized',null,new.station_id,new.battery_id,v_final::numeric/100,null
  );

  select * into v_orch
  from public.append_rental_orchestrator_event(
    new.id,v_orch.version,'payment_captured',
    format('payment_captured:membership_prepaid:%s',new.id),v_now,
    jsonb_build_object(
      'source','chargeurs_pass_wallet','committed_cents',v_final,
      'released_cents',v_reservation.held_cents-v_final,
      'wallet_release_entry_id',v_release.entry_id,
      'wallet_debit_entry_id',case when v_final>0 then v_debit.entry_id else null end,
      'stripe_side_effect',false
    ),
    'payment_captured',null,new.station_id,new.battery_id,v_final::numeric/100,null
  );

  select * into v_orch
  from public.append_rental_orchestrator_event(
    new.id,v_orch.version,'rental_completed',
    format('rental_completed:membership_prepaid:%s',new.id),v_now,
    jsonb_build_object('source','chargeurs_pass_wallet','final_amount_cents',v_final),
    'completed',null,new.station_id,new.battery_id,v_final::numeric/100,null
  );

  update public.payments
  set amount=v_final::numeric/100,
      status='succeeded',
      amount_authorized_cents=v_reservation.held_cents,
      amount_captured_cents=v_final,
      amount_refunded_cents=0
  where rental_session_id=new.id and provider='chargeurs_wallet';

  update public.rental_sessions
  set state='completed',
      final_amount_cents=v_final,
      amount_paid=v_final::numeric/100,
      captured_amount_cents=v_final,
      refunded_amount_cents=0,
      supplemental_amount_cents=0,
      settlement_status='settled',
      settlement_error=null,
      settlement_locked_at=null,
      completed_at=coalesce(completed_at,v_now),
      closed_at=coalesce(closed_at,v_now),
      updated_at=v_now
  where id=new.id;

  insert into public.audit_logs(action,target,data)
  values(
    'chargeurs_pass_wallet.rental_settled',new.id::text,
    jsonb_build_object(
      'reserved_cents',v_reservation.held_cents,'committed_cents',v_final,
      'released_cents',v_reservation.held_cents-v_final,'allocated_cents',v_allocated,
      'currency','CHF','stripe_side_effect',false
    )
  );

  return new;
end;
$function$;

-- Price assertions use the same snapshot shape consumed by the runtime pricing
-- function. They fail the migration atomically if the intended pilot policy is
-- not reproduced exactly.
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
    'pricing_rules_version',3,
    'customer_segment','member',
    'currency','CHF',
    'initial_fee_cents',v_profile.initial_fee_cents,
    'period_minutes',v_profile.period_minutes,
    'price_per_period_cents',v_profile.price_per_period_cents,
    'included_minutes',v_profile.included_minutes,
    'grace_minutes',v_profile.grace_minutes,
    'daily_cap_cents',v_profile.daily_cap_cents,
    'total_cap_cents',v_profile.total_cap_cents,
    'max_amount_cents',v_profile.max_amount_cents,
    'min_amount_cents',v_profile.min_amount_cents,
    'deposit_cents',v_profile.deposit_cents,
    'unreturned_fee_cents',v_profile.unreturned_fee_cents,
    'unreturned_after_minutes',v_profile.unreturned_after_minutes,
    'rounding',v_profile.rounding,
    'tax_percent',v_profile.tax_percent,
    'tiered',false,
    'tiers','[]'::jsonb
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
