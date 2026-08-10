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
    elsif old.state = 'eject_failed' and new.state = 'refunded' then
      select (
        old.ejected_at is null
        and new.ejected_at is null
        and not exists (
          select 1
          from public.hardware_release_attempts h
          where h.rental_session_id = old.id
            and h.result = 'single_release'
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
