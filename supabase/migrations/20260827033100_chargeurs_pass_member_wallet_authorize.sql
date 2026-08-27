-- Preserve the existing kiosk payment-rail contract while making the real CHF
-- wallet the financial source for member prepaid rentals.
create or replace function public.authorize_member_prepaid_rental(
  p_rental_id uuid,
  p_kiosk_device_id uuid,
  p_correlation_id uuid default null
)
returns table(authorized boolean,reason text,reserved_cents bigint,currency text)
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_session public.rental_sessions%rowtype;
  v_snapshot jsonb;
  v_orch public.rental_orchestrator_snapshots%rowtype;
  v_wallet public.wallets%rowtype;
  v_existing public.wallet_rental_reservations%rowtype;
  v_hold record;
  v_balance integer:=0;
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
    return query select false,'NOT_MEMBER'::text,0::bigint,'CHF'::text; return;
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

  select * into v_existing from public.wallet_rental_reservations where rental_session_id=p_rental_id for update;
  if found then
    if v_existing.user_id is distinct from v_session.customer_user_id or v_existing.held_cents<>v_required then
      raise exception 'PASS_WALLET_RESERVATION_CONFLICT';
    end if;
    if v_existing.status='reserved' and v_session.settlement_strategy='membership_prepaid' and v_session.settlement_status='prepaid' then
      return query select true,'ALREADY_AUTHORIZED'::text,v_required::bigint,'CHF'::text; return;
    end if;
    raise exception 'PASS_WALLET_RESERVATION_NOT_AUTHORIZABLE';
  end if;

  if v_session.paid_at is not null or v_session.stripe_checkout_session_id is not null or v_session.stripe_payment_intent_id is not null then
    raise exception 'PAYMENT_ALREADY_STARTED';
  end if;
  if v_session.state not in ('created','payment_pending') then raise exception 'SESSION_NOT_PREPAID_AUTHORIZABLE'; end if;

  select * into v_wallet from public.wallets where user_id=v_session.customer_user_id and currency='CHF' for update;
  if not found then return query select false,'INSUFFICIENT_PREPAID_BALANCE'::text,0::bigint,'CHF'::text; return; end if;
  select coalesce(l.balance_after_cents,0) into v_balance from public.wallet_ledger l
    where l.wallet_id=v_wallet.id order by l.created_at desc,l.id desc limit 1;
  v_balance:=coalesce(v_balance,0);
  if v_balance<v_required then return query select false,'INSUFFICIENT_PREPAID_BALANCE'::text,0::bigint,'CHF'::text; return; end if;

  v_rail:=public.claim_rental_payment_rail(
    p_rental_id,'membership_prepaid',p_correlation_id,
    jsonb_build_object('source','chargeurs_pass_wallet','required_cents',v_required)
  );
  if v_rail<>'PREPAID' then raise exception 'MEMBER_PREPAID_RAIL_CLAIM_FAILED'; end if;

  select * into v_hold from public.append_wallet_entry_server(
    v_session.customer_user_id,-v_required,'hold','pass_rental_hold:'||p_rental_id::text,
    'reservation','rental',p_rental_id::text,null,null,p_rental_id,null,
    'Réserve location Chargeurs Pass',jsonb_build_object('correlation_id',p_correlation_id)
  );

  insert into public.wallet_rental_reservations(rental_session_id,wallet_id,user_id,currency,held_cents,status)
  values(p_rental_id,v_wallet.id,v_session.customer_user_id,'CHF',v_required,'reserved');

  select * into v_orch from public.rental_orchestrator_snapshots where rental_id=p_rental_id for update;
  if not found then raise exception 'ORCHESTRATOR_SNAPSHOT_MISSING'; end if;
  if v_orch.state='created' then
    select * into v_orch from public.append_rental_orchestrator_event(
      p_rental_id,v_orch.version,'payment_started',format('payment_started:membership_prepaid:%s',p_rental_id),v_now,
      jsonb_build_object('source','chargeurs_pass_wallet','reserved_cents',v_required),
      'payment_pending',null,v_session.station_id,v_session.battery_id,null,null
    );
  end if;
  if v_orch.state<>'payment_pending' then raise exception 'ORCHESTRATOR_NOT_PAYMENT_PENDING'; end if;
  select * into v_orch from public.append_rental_orchestrator_event(
    p_rental_id,v_orch.version,'payment_authorized',format('payment_authorized:membership_prepaid:%s',p_rental_id),v_now,
    jsonb_build_object('source','chargeurs_pass_wallet','reserved_cents',v_required,'wallet_hold_entry_id',v_hold.entry_id,'currency','CHF','stripe_side_effect',false),
    'authorized',null,v_session.station_id,v_session.battery_id,null,null
  );

  update public.rental_sessions set
    state='payment_succeeded',settlement_strategy='membership_prepaid',settlement_status='prepaid',settlement_error=null,
    paid_at=v_now,amount_paid=0,captured_amount_cents=0,refunded_amount_cents=0,supplemental_amount_cents=0,updated_at=v_now
  where id=p_rental_id;

  insert into public.payments(
    rental_session_id,provider,amount,currency,payment_method,status,settlement_strategy,
    amount_authorized_cents,amount_captured_cents,amount_refunded_cents
  ) values(p_rental_id,'chargeurs_wallet',0,'CHF','prepaid_balance','authorized','membership_prepaid',v_required,0,0)
  on conflict(rental_session_id) where provider='chargeurs_wallet' do update set
    status='authorized',settlement_strategy='membership_prepaid',amount_authorized_cents=v_required;

  insert into public.audit_logs(action,target,data) values(
    'chargeurs_pass_wallet.rental_authorized',p_rental_id::text,
    jsonb_build_object('reserved_cents',v_required,'currency','CHF','wallet_id',v_wallet.id,'wallet_hold_entry_id',v_hold.entry_id,
      'pricing_rules_version',3,'stripe_side_effect',false,'correlation_id',p_correlation_id)
  );

  return query select true,'AUTHORIZED'::text,v_required::bigint,'CHF'::text;
end;
$function$;
revoke all on function public.authorize_member_prepaid_rental(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.authorize_member_prepaid_rental(uuid,uuid,uuid) to service_role;
