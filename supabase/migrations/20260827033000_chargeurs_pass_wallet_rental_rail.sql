-- Route the existing member prepaid rail through the real CHF wallet.
-- The public RPC signature and settlement_strategy value stay compatible with
-- the kiosk/orchestrator. Internally, CHF 30 is held in wallet_ledger and the
-- final rental amount is debited only after return.

create or replace function public.authorize_member_prepaid_rental(
  p_rental_id uuid,
  p_kiosk_device_id uuid,
  p_correlation_id uuid default null
)
returns table(authorized boolean, reason text, reserved_cents bigint, currency text)
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_session public.rental_sessions%rowtype;
  v_snapshot jsonb;
  v_orch public.rental_orchestrator_snapshots%rowtype;
  v_wallet public.wallets%rowtype;
  v_reservation public.wallet_rental_reservations%rowtype;
  v_hold record;
  v_rail text;
  v_now timestamptz:=now();
  v_terms constant text:='terms-2026-08-26-preproduction-v2';
  v_privacy constant text:='privacy-2026-08-26-preproduction-v2';
  v_required constant integer:=3000;
begin
  select * into v_session from public.rental_sessions where id=p_rental_id for update;
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
     or coalesce((v_snapshot->>'unreturned_fee_cents')::integer,0)<>v_required
     or coalesce((v_snapshot->>'max_amount_cents')::integer,0)<>v_required then
    raise exception 'MEMBER_PREPAID_V3_SNAPSHOT_REQUIRED';
  end if;

  select * into v_reservation from public.wallet_rental_reservations
  where rental_session_id=p_rental_id for update;
  if found then
    if v_reservation.user_id<>v_session.customer_user_id
       or v_reservation.held_cents<>v_required
       or upper(v_reservation.currency)<>'CHF' then raise exception 'WALLET_RESERVATION_INTEGRITY_MISMATCH'; end if;
    if v_reservation.status='reserved' and v_session.settlement_strategy='membership_prepaid'
       and v_session.settlement_status='prepaid' then
      return query select true,'ALREADY_AUTHORIZED'::text,v_reservation.held_cents::bigint,'CHF'::text;
      return;
    end if;
    raise exception 'WALLET_RESERVATION_NOT_AUTHORIZABLE';
  end if;

  if v_session.paid_at is not null
     or v_session.stripe_checkout_session_id is not null
     or v_session.stripe_payment_intent_id is not null then raise exception 'PAYMENT_ALREADY_STARTED'; end if;
  if v_session.state not in ('created','payment_pending') then raise exception 'SESSION_NOT_PREPAID_AUTHORIZABLE'; end if;

  insert into public.wallets(user_id,currency) values(v_session.customer_user_id,'CHF')
  on conflict(user_id,currency) do nothing;
  select * into v_wallet from public.wallets
  where user_id=v_session.customer_user_id and currency='CHF' for update;
  if not found then raise exception 'PASS_WALLET_NOT_FOUND'; end if;

  v_rail:=public.claim_rental_payment_rail(
    p_rental_id,
    'membership_prepaid',
    p_correlation_id,
    jsonb_build_object('source','chargeurs_pass_wallet','required_cents',v_required)
  );
  if v_rail<>'PREPAID' then raise exception 'MEMBER_PREPAID_RAIL_CLAIM_FAILED'; end if;

  begin
    select * into v_hold from public.append_wallet_entry_server(
      v_session.customer_user_id,
      -v_required,
      'hold',
      'wallet_rental_hold:'||p_rental_id::text,
      'reservation',
      'rental_hold',
      p_rental_id::text,
      null,
      null,
      p_rental_id,
      null,
      'Réservation location Chargeurs Pass',
      jsonb_build_object('rental_session_id',p_rental_id,'held_cents',v_required)
    );
  exception
    when others then
      if sqlerrm like '%WALLET_NEGATIVE_BALANCE%' then
        perform public.release_rental_payment_rail_claim(p_rental_id,'membership_prepaid','insufficient_wallet_balance');
        return query select false,'INSUFFICIENT_PREPAID_BALANCE'::text,0::bigint,'CHF'::text;
        return;
      end if;
      raise;
  end;

  insert into public.wallet_rental_reservations(
    rental_session_id,wallet_id,user_id,currency,held_cents,status
  ) values(
    p_rental_id,v_wallet.id,v_session.customer_user_id,'CHF',v_required,'reserved'
  );

  select * into v_orch from public.rental_orchestrator_snapshots
  where rental_id=p_rental_id for update;
  if not found then raise exception 'ORCHESTRATOR_SNAPSHOT_MISSING'; end if;

  if v_orch.state='created' then
    select * into v_orch from public.append_rental_orchestrator_event(
      p_rental_id,v_orch.version,'payment_started',
      format('payment_started:membership_prepaid:%s',p_rental_id),v_now,
      jsonb_build_object('source','chargeurs_pass_wallet','reserved_cents',v_required),
      'payment_pending',null,v_session.station_id,v_session.battery_id,null,null
    );
  end if;
  if v_orch.state<>'payment_pending' then raise exception 'ORCHESTRATOR_NOT_PAYMENT_PENDING'; end if;

  select * into v_orch from public.append_rental_orchestrator_event(
    p_rental_id,v_orch.version,'payment_authorized',
    format('payment_authorized:membership_prepaid:%s',p_rental_id),v_now,
    jsonb_build_object('source','chargeurs_pass_wallet','reserved_cents',v_required,'currency','CHF','stripe_side_effect',false),
    'authorized',null,v_session.station_id,v_session.battery_id,null,null
  );

  update public.rental_sessions set
    state='payment_succeeded',
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

  insert into public.audit_logs(action,target,data) values(
    'chargeurs_wallet.rental_authorized',p_rental_id::text,
    jsonb_build_object('reserved_cents',v_required,'currency','CHF','pricing_rules_version',3,'stripe_side_effect',false,'correlation_id',p_correlation_id)
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
     or coalesce(v_snapshot->>'customer_segment','')<>'member' then raise exception 'MEMBER_PREPAID_V3_SNAPSHOT_REQUIRED'; end if;

  select * into v_reservation from public.wallet_rental_reservations
  where rental_session_id=new.id for update;
  if not found or v_reservation.status<>'reserved' or v_reservation.held_cents<>3000
     or v_reservation.user_id is distinct from new.customer_user_id then raise exception 'PASS_WALLET_RESERVATION_REQUIRED'; end if;

  v_pricing:=public.customer_wallet_pricing_state(
    v_snapshot,coalesce(new.started_at,new.ejected_at,new.created_at),new.returned_at
  );
  if v_pricing is null then raise exception 'MEMBER_PREPAID_PRICING_FAILED'; end if;
  v_final:=coalesce((v_pricing->>'final_cents')::integer,-1);
  if v_final<0 or v_final>v_reservation.held_cents then raise exception 'MEMBER_PREPAID_FINAL_AMOUNT_INVALID'; end if;

  select * into v_release from public.append_wallet_entry_server(
    new.customer_user_id,
    v_reservation.held_cents,
    'release',
    'wallet_rental_release:'||new.id::text,
    'reservation',
    'rental_release',
    new.id::text,
    null,
    null,
    new.id,
    null,
    'Libération réservation location',
    jsonb_build_object('rental_session_id',new.id,'released_cents',v_reservation.held_cents)
  );

  if v_final>0 then
    select * into v_debit from public.append_wallet_entry_server(
      new.customer_user_id,
      -v_final,
      'debit',
      'wallet_rental_debit:'||new.id::text,
      'other',
      'rental',
      new.id::text,
      null,
      null,
      new.id,
      null,
      'Location Chargeurs Pass',
      jsonb_build_object('rental_session_id',new.id,'final_cents',v_final)
    );
    v_allocated:=public.allocate_wallet_debit_server(v_debit.entry_id);
    if v_allocated<>v_final then raise exception 'WALLET_DEBIT_ALLOCATION_MISMATCH'; end if;
  end if;

  update public.wallet_rental_reservations set
    final_cents=v_final,status='settled',settled_at=v_now
  where rental_session_id=new.id;

  select * into v_orch from public.rental_orchestrator_snapshots
  where rental_id=new.id for update;
  if not found then raise exception 'ORCHESTRATOR_SNAPSHOT_MISSING'; end if;
  if v_orch.state<>'return_detected' then raise exception 'ORCHESTRATOR_NOT_RETURN_DETECTED'; end if;

  select * into v_orch from public.append_rental_orchestrator_event(
    new.id,v_orch.version,'pricing_finalized',
    format('pricing_finalized:membership_prepaid:%s',new.id),new.returned_at,
    jsonb_build_object('source','chargeurs_pass_wallet','finalAmountCents',v_final,'pricingSnapshot',v_snapshot||v_pricing),
    'pricing_finalized',null,new.station_id,new.battery_id,v_final::numeric/100,null
  );

  select * into v_orch from public.append_rental_orchestrator_event(
    new.id,v_orch.version,'payment_captured',
    format('payment_captured:membership_prepaid:%s',new.id),v_now,
    jsonb_build_object('source','chargeurs_pass_wallet','committed_cents',v_final,'released_cents',3000-v_final,'stripe_side_effect',false),
    'payment_captured',null,new.station_id,new.battery_id,v_final::numeric/100,null
  );

  select * into v_orch from public.append_rental_orchestrator_event(
    new.id,v_orch.version,'rental_completed',
    format('rental_completed:membership_prepaid:%s',new.id),v_now,
    jsonb_build_object('source','chargeurs_pass_wallet','final_amount_cents',v_final),
    'completed',null,new.station_id,new.battery_id,v_final::numeric/100,null
  );

  update public.payments set
    amount=v_final::numeric/100,status='succeeded',amount_authorized_cents=3000,
    amount_captured_cents=v_final,amount_refunded_cents=0
  where rental_session_id=new.id and provider='chargeurs_wallet';

  update public.rental_sessions set
    state='completed',final_amount_cents=v_final,amount_paid=v_final::numeric/100,
    captured_amount_cents=v_final,refunded_amount_cents=0,supplemental_amount_cents=0,
    settlement_status='settled',settlement_error=null,settlement_locked_at=null,
    completed_at=coalesce(completed_at,v_now),closed_at=coalesce(closed_at,v_now),updated_at=v_now
  where id=new.id;

  insert into public.audit_logs(action,target,data) values(
    'chargeurs_wallet.rental_settled',new.id::text,
    jsonb_build_object('reserved_cents',3000,'committed_cents',v_final,'released_cents',3000-v_final,'currency','CHF','stripe_side_effect',false)
  );

  return new;
end;
$function$;
