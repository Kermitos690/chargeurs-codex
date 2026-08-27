-- Settle a returned member rental by releasing the CHF 30 reservation, debiting
-- the exact final price, and allocating the spend back to paid/promo credits.
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
  if old.returned_at is not null or new.returned_at is null
     or new.settlement_strategy<>'membership_prepaid' or new.settlement_status<>'prepaid' then return new; end if;

  v_snapshot:=new.pricing_snapshot;
  if v_snapshot is null
     or coalesce((v_snapshot->>'pricing_rules_version')::integer,0)<>3
     or coalesce(v_snapshot->>'customer_segment','')<>'member'
     or coalesce((v_snapshot->>'min_amount_cents')::integer,0)<>200
     or coalesce((v_snapshot->>'period_minutes')::integer,0)<>30
     or coalesce((v_snapshot->>'price_per_period_cents')::integer,0)<>50 then
    raise exception 'PASS_MEMBER_WALLET_PRICING_SNAPSHOT_REQUIRED';
  end if;

  select * into v_reservation from public.wallet_rental_reservations where rental_session_id=new.id for update;
  if not found or v_reservation.status<>'reserved' or v_reservation.held_cents<>3000 then raise exception 'PASS_WALLET_RESERVATION_REQUIRED'; end if;

  v_pricing:=public.customer_wallet_pricing_state(v_snapshot,coalesce(new.started_at,new.ejected_at,new.created_at),new.returned_at);
  if v_pricing is null then raise exception 'PASS_MEMBER_WALLET_PRICING_FAILED'; end if;
  v_final:=coalesce((v_pricing->>'final_cents')::integer,-1);
  if v_final<0 or v_final>v_reservation.held_cents then raise exception 'PASS_MEMBER_WALLET_FINAL_AMOUNT_INVALID'; end if;

  select * into v_release from public.append_wallet_entry_server(
    new.customer_user_id,v_reservation.held_cents,'release','pass_rental_release:'||new.id::text,
    'reservation','rental',new.id::text,null,null,new.id,null,
    'Libération réserve location Chargeurs Pass',jsonb_build_object('final_cents',v_final)
  );

  if v_final>0 then
    select * into v_debit from public.append_wallet_entry_server(
      new.customer_user_id,-v_final,'debit','pass_rental_debit:'||new.id::text,
      'other','rental',new.id::text,null,null,new.id,null,
      'Location Chargeurs Pass',jsonb_build_object('final_cents',v_final,'returned_at',new.returned_at)
    );
    v_allocated:=public.allocate_wallet_debit_server(v_debit.entry_id);
    if v_allocated<>v_final then raise exception 'PASS_WALLET_ALLOCATION_MISMATCH'; end if;
  end if;

  update public.wallet_rental_reservations
  set final_cents=v_final,status='settled',settled_at=v_now,released_at=v_now
  where rental_session_id=new.id;

  select * into v_orch from public.rental_orchestrator_snapshots where rental_id=new.id for update;
  if not found then raise exception 'ORCHESTRATOR_SNAPSHOT_MISSING'; end if;
  if v_orch.state<>'return_detected' then raise exception 'ORCHESTRATOR_NOT_RETURN_DETECTED'; end if;

  select * into v_orch from public.append_rental_orchestrator_event(
    new.id,v_orch.version,'pricing_finalized',format('pricing_finalized:membership_prepaid:%s',new.id),new.returned_at,
    jsonb_build_object('source','chargeurs_pass_wallet','finalAmountCents',v_final,'pricingSnapshot',v_snapshot||v_pricing),
    'pricing_finalized',null,new.station_id,new.battery_id,v_final::numeric/100,null
  );
  select * into v_orch from public.append_rental_orchestrator_event(
    new.id,v_orch.version,'payment_captured',format('payment_captured:membership_prepaid:%s',new.id),v_now,
    jsonb_build_object('source','chargeurs_pass_wallet','committed_cents',v_final,
      'released_cents',v_reservation.held_cents-v_final,'wallet_release_entry_id',v_release.entry_id,
      'wallet_debit_entry_id',case when v_final>0 then v_debit.entry_id else null end,'stripe_side_effect',false),
    'payment_captured',null,new.station_id,new.battery_id,v_final::numeric/100,null
  );
  select * into v_orch from public.append_rental_orchestrator_event(
    new.id,v_orch.version,'rental_completed',format('rental_completed:membership_prepaid:%s',new.id),v_now,
    jsonb_build_object('source','chargeurs_pass_wallet','final_amount_cents',v_final),
    'completed',null,new.station_id,new.battery_id,v_final::numeric/100,null
  );

  update public.payments set
    amount=v_final::numeric/100,status='succeeded',amount_authorized_cents=v_reservation.held_cents,
    amount_captured_cents=v_final,amount_refunded_cents=0
  where rental_session_id=new.id and provider='chargeurs_wallet';

  update public.rental_sessions set
    state='completed',final_amount_cents=v_final,amount_paid=v_final::numeric/100,captured_amount_cents=v_final,
    refunded_amount_cents=0,supplemental_amount_cents=0,settlement_status='settled',settlement_error=null,
    settlement_locked_at=null,completed_at=coalesce(completed_at,v_now),closed_at=coalesce(closed_at,v_now),updated_at=v_now
  where id=new.id;

  insert into public.audit_logs(action,target,data) values(
    'chargeurs_pass_wallet.rental_settled',new.id::text,
    jsonb_build_object('reserved_cents',v_reservation.held_cents,'committed_cents',v_final,
      'released_cents',v_reservation.held_cents-v_final,'allocated_cents',v_allocated,'currency','CHF','stripe_side_effect',false)
  );
  return new;
end;
$function$;
