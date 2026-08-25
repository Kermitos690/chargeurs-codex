-- Atomically finish a Terminal cancellation only after Stripe cancellation is
-- already persisted locally. This deliberately refuses any rental that has
-- reached a physical release or captured money.
create or replace function public.finalize_confirmed_terminal_cancellation(
  p_rental_id uuid,
  p_reason text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.rental_sessions%rowtype;
  v_attempt public.stripe_terminal_payment_attempts%rowtype;
  v_now timestamptz := now();
begin
  select * into v_session
  from public.rental_sessions
  where id = p_rental_id
  for update;

  if not found then
    raise exception 'RENTAL_SESSION_NOT_FOUND';
  end if;

  if v_session.paid_at is not null
     or v_session.ejected_at is not null
     or v_session.returned_at is not null
     or v_session.completed_at is not null then
    raise exception 'TERMINAL_CANCELLATION_AFTER_RENTAL_PROGRESS';
  end if;

  if exists (
    select 1 from public.hardware_release_attempts h
    where h.rental_session_id = p_rental_id
      and h.command_sent_at is not null
  ) then
    raise exception 'TERMINAL_CANCELLATION_AFTER_HARDWARE_COMMAND';
  end if;

  select * into v_attempt
  from public.stripe_terminal_payment_attempts
  where rental_session_id = p_rental_id
  for update;

  if found and (
    v_attempt.reconciliation_required
    or v_attempt.status not in ('canceled', 'failed', 'timed_out')
  ) then
    raise exception 'TERMINAL_CANCELLATION_NOT_STRIPE_CONFIRMED';
  end if;

  if exists (
    select 1 from public.payments p
    where p.rental_session_id = p_rental_id
      and (
        coalesce(p.amount_captured_cents, 0) <> 0
        or coalesce(p.amount_refunded_cents, 0) <> 0
      )
  ) then
    raise exception 'TERMINAL_CANCELLATION_FINANCIAL_SIDE_EFFECT';
  end if;

  update public.payments
  set status = 'canceled',
      amount_authorized_cents = 0,
      amount_captured_cents = 0,
      amount_refunded_cents = 0,
      refunded_at = null
  where rental_session_id = p_rental_id;

  update public.station_slot_reservations
  set state = 'released',
      released_at = v_now,
      release_reason = left(coalesce(p_reason, 'terminal_cancelled'), 200),
      updated_at = v_now
  where rental_session_id = p_rental_id
    and state = 'reserved';

  perform public.release_rental_payment_rail_claim(
    p_rental_id,
    'stripe_terminal',
    left(coalesce(p_reason, 'terminal_cancelled'), 200)
  );

  update public.rental_sessions
  set state = 'payment_cancelled',
      cancelled_at = coalesce(cancelled_at, v_now),
      failure_code = 'TERMINAL_CANCELLED_CONFIRMED',
      failure_message = 'Paiement Terminal annulé après confirmation Stripe, sans commande matérielle',
      updated_at = v_now
  where id = p_rental_id;

  return 'CANCELLED';
end;
$$;

revoke all on function public.finalize_confirmed_terminal_cancellation(uuid,text) from public, anon, authenticated;
grant execute on function public.finalize_confirmed_terminal_cancellation(uuid,text) to service_role;

-- A stale support state may be repaired to payment_cancelled only when the
-- same evidence checked above proves there was no release and no capture.
create or replace function public.enforce_rental_session_state_machine()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_scoped_resume boolean := false;
  v_verified_compensation boolean := false;
  v_verified_terminal_cancellation boolean := false;
begin
  if tg_op = 'UPDATE' and new.state is distinct from old.state then
    if old.state = 'needs_support'
       and old.failure_code = 'HARDWARE_EJECTION_DISABLED'
       and new.state = 'ejecting' then
      select exists (
        select 1 from public.one_time_rental_ejection_permits p
        where p.rental_session_id = old.id
          and p.station_id = coalesce(old.cabinet_id, old.station_id)
          and p.slot_num = old.selected_slot_num
          and p.consumed_at is null
          and p.expires_at > now()
      ) into v_scoped_resume;
      if not v_scoped_resume then
        raise exception 'ONE_TIME_RENTAL_EJECTION_NOT_PERMITTED' using errcode = 'P0001';
      end if;
    elsif old.state = 'needs_support' and new.state = 'payment_cancelled' then
      select (
        old.paid_at is null and old.ejected_at is null and old.returned_at is null and old.completed_at is null
        and not exists (
          select 1 from public.hardware_release_attempts h
          where h.rental_session_id = old.id and h.command_sent_at is not null
        )
        and not exists (
          select 1 from public.payments p
          where p.rental_session_id = old.id
            and (coalesce(p.amount_authorized_cents, 0) <> 0
              or coalesce(p.amount_captured_cents, 0) <> 0
              or coalesce(p.amount_refunded_cents, 0) <> 0
              or p.status <> 'canceled')
        )
        and exists (
          select 1 from public.stripe_terminal_payment_attempts a
          where a.rental_session_id = old.id
            and a.status = 'canceled'
            and a.canceled_at is not null
            and not a.reconciliation_required
        )
      ) into v_verified_terminal_cancellation;
      if not v_verified_terminal_cancellation then
        raise exception 'UNVERIFIED_TERMINAL_CANCELLATION' using errcode = 'P0001';
      end if;
    elsif old.state in ('eject_failed','completed') and new.state = 'refunded' then
      select (
        old.ejected_at is null and new.ejected_at is null
        and not exists (
          select 1 from public.hardware_release_attempts h
          where h.rental_session_id = old.id and h.command_sent_at is not null
        )
        and exists (
          select 1 from public.payments p
          where p.rental_session_id = old.id and p.status = 'refunded'
            and coalesce(p.amount_refunded_cents, 0) >= greatest(coalesce(p.amount_authorized_cents, 0), coalesce(p.amount_captured_cents, 0))
        )
      ) into v_verified_compensation;
      if not v_verified_compensation then
        raise exception 'UNVERIFIED_PRE_EJECTION_COMPENSATION' using errcode = 'P0001';
      end if;
    elsif not public.rental_session_transition_allowed(old.state, new.state) then
      raise exception 'RENTAL_STATE_REGRESSION: % -> %', old.state, new.state using errcode = 'P0001';
    end if;
    new.state_version := old.state_version + 1;
  elsif tg_op = 'UPDATE' then
    new.state_version := old.state_version;
  end if;
  return new;
end;
$$;

comment on function public.finalize_confirmed_terminal_cancellation(uuid,text) is
  'Atomically clears only a Stripe-confirmed pre-ejection Terminal cancellation.';
