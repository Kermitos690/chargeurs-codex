-- Release a Pass wallet reservation only when a rental reaches a terminal
-- pre-ejection state and there is positive evidence that no hardware release
-- command was sent and no battery was released/activated.
create or replace function public.release_pass_wallet_hold_on_safe_pre_release_terminal_state()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_reservation public.wallet_rental_reservations%rowtype;
  v_release record;
  v_now timestamptz:=now();
begin
  if old.state is not distinct from new.state then return new; end if;
  if new.settlement_strategy<>'membership_prepaid' then return new; end if;
  if new.state not in ('payment_cancelled','payment_failed','payment_expired','cancelled','failed') then return new; end if;
  if new.ejected_at is not null or new.returned_at is not null then return new; end if;

  select * into v_reservation
  from public.wallet_rental_reservations
  where rental_session_id=new.id
  for update;
  if not found or v_reservation.status<>'reserved' then return new; end if;

  if exists(
    select 1 from public.hardware_release_attempts h
    where h.rental_session_id=new.id and h.command_sent_at is not null
  ) then return new; end if;

  if exists(
    select 1 from public.rental_orchestrator_events e
    where e.rental_id=new.id and e.event_type in ('battery_released','rental_activated')
  ) then return new; end if;

  select * into v_release from public.append_wallet_entry_server(
    new.customer_user_id,v_reservation.held_cents,'release','pass_rental_terminal_release:'||new.id::text,
    'reservation','rental',new.id::text,null,null,new.id,null,
    'Libération réserve — location non démarrée',jsonb_build_object('terminal_state',new.state)
  );

  update public.wallet_rental_reservations
  set status='released',released_at=v_now
  where rental_session_id=new.id;

  perform public.release_rental_payment_rail_claim(new.id,'membership_prepaid','safe_pre_release_terminal_state:'||new.state);

  update public.payments
  set status='canceled',amount_authorized_cents=0,amount_captured_cents=0,amount_refunded_cents=0
  where rental_session_id=new.id and provider='chargeurs_wallet';

  insert into public.audit_logs(action,target,data) values(
    'chargeurs_pass_wallet.reservation_released_pre_ejection',new.id::text,
    jsonb_build_object('released_cents',v_reservation.held_cents,'state',new.state,'wallet_release_entry_id',v_release.entry_id)
  );
  return new;
end;
$function$;

drop trigger if exists trg_release_pass_wallet_hold_safe_pre_release on public.rental_sessions;
create trigger trg_release_pass_wallet_hold_safe_pre_release
after update of state on public.rental_sessions
for each row execute function public.release_pass_wallet_hold_on_safe_pre_release_terminal_state();
