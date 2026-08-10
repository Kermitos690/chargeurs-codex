create or replace function public.enforce_rental_session_state_machine()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_scoped_resume boolean := false;
  v_verified_compensation boolean := false;
begin
  if tg_op = 'UPDATE' and new.state is distinct from old.state then
    if old.state = 'needs_support'
       and old.failure_code = 'HARDWARE_EJECTION_DISABLED'
       and new.state = 'ejecting' then
      select exists (
        select 1
        from public.one_time_rental_ejection_permits p
        where p.rental_session_id = old.id
          and p.station_id = coalesce(old.cabinet_id, old.station_id)
          and p.slot_num = old.selected_slot_num
          and p.consumed_at is null
          and p.expires_at > now()
      ) into v_scoped_resume;

      if not v_scoped_resume then
        raise exception 'ONE_TIME_RENTAL_EJECTION_NOT_PERMITTED' using errcode = 'P0001';
      end if;
    elsif old.state in ('eject_failed','completed') and new.state = 'refunded' then
      select (
        old.ejected_at is null
        and new.ejected_at is null
        and not exists (
          select 1
          from public.hardware_release_attempts h
          where h.rental_session_id = old.id
            and h.command_sent_at is not null
        )
        and exists (
          select 1
          from public.payments p
          where p.rental_session_id = old.id
            and p.status = 'refunded'
            and coalesce(p.amount_refunded_cents, 0) >= greatest(
              coalesce(p.amount_authorized_cents, 0),
              coalesce(p.amount_captured_cents, 0)
            )
        )
      ) into v_verified_compensation;

      if not v_verified_compensation then
        raise exception 'UNVERIFIED_PRE_EJECTION_COMPENSATION' using errcode = 'P0001';
      end if;
    elsif not public.rental_session_transition_allowed(old.state, new.state) then
      raise exception 'RENTAL_STATE_REGRESSION: % -> %', old.state, new.state
        using errcode = 'P0001';
    end if;

    new.state_version := old.state_version + 1;
  elsif tg_op = 'UPDATE' then
    new.state_version := old.state_version;
  end if;
  return new;
end;
$$;

create or replace function public.sync_refunded_payment_to_rental_session()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.rental_session_id is null
     or new.status <> 'refunded'
     or coalesce(new.amount_refunded_cents, 0) < greatest(
       coalesce(new.amount_authorized_cents, 0),
       coalesce(new.amount_captured_cents, 0)
     ) then
    return new;
  end if;

  update public.rental_sessions rs
  set state = 'refunded',
      settlement_status = 'settled',
      refunded_amount_cents = greatest(coalesce(rs.refunded_amount_cents, 0), coalesce(new.amount_refunded_cents, 0)),
      closed_at = coalesce(rs.closed_at, now()),
      failure_code = null,
      failure_message = null,
      chargenow_status = case
        when rs.ejected_at is null then 'compensated_before_hardware'
        else rs.chargenow_status
      end
  where rs.id = new.rental_session_id
    and rs.ejected_at is null
    and not exists (
      select 1
      from public.hardware_release_attempts h
      where h.rental_session_id = rs.id
        and h.command_sent_at is not null
    );

  return new;
end;
$$;

drop trigger if exists trg_sync_refunded_payment_to_rental_session on public.payments;
create trigger trg_sync_refunded_payment_to_rental_session
after insert or update of status, amount_refunded_cents, amount_authorized_cents, amount_captured_cents
on public.payments
for each row
execute function public.sync_refunded_payment_to_rental_session();

update public.rental_sessions rs
set state = 'refunded',
    settlement_status = 'settled',
    refunded_amount_cents = greatest(coalesce(rs.refunded_amount_cents, 0), coalesce(p.amount_refunded_cents, 0)),
    closed_at = coalesce(rs.closed_at, now()),
    failure_code = null,
    failure_message = null,
    chargenow_status = 'compensated_before_hardware'
from public.payments p
where p.rental_session_id = rs.id
  and p.status = 'refunded'
  and coalesce(p.amount_refunded_cents, 0) >= greatest(coalesce(p.amount_authorized_cents, 0), coalesce(p.amount_captured_cents, 0))
  and rs.ejected_at is null
  and not exists (
    select 1 from public.hardware_release_attempts h
    where h.rental_session_id = rs.id and h.command_sent_at is not null
  )
  and rs.state in ('eject_failed','completed','refunded');
