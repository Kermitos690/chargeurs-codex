-- FIELD_DEPLOYMENT_RC1: make every future rental_session insert that selects a
-- physical slot reserve that slot in the same database transaction. This also
-- protects currently deployed Edge Function versions that still insert
-- rental_sessions directly instead of calling create_reserved_kiosk_rental_session.

create or replace function public.ensure_inserted_rental_slot_reservation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.selected_slot_num is null or new.station_id is null or new.expires_at is null then
    return new;
  end if;

  insert into public.station_slot_reservations (
    station_id, slot_num, battery_id, rental_session_id, state, expires_at
  ) values (
    new.station_id, new.selected_slot_num, new.battery_id, new.id, 'reserved', new.expires_at
  );

  return new;
end;
$$;

drop trigger if exists trg_ensure_inserted_rental_slot_reservation on public.rental_sessions;
create trigger trg_ensure_inserted_rental_slot_reservation
  after insert on public.rental_sessions
  for each row execute function public.ensure_inserted_rental_slot_reservation();

-- Keep the explicit RPC as the preferred API. It serializes competing requests
-- for a clean SLOT_ALREADY_RESERVED error; the insert trigger owns the actual
-- reservation write so direct and RPC paths share one atomic invariant.
create or replace function public.create_reserved_kiosk_rental_session(
  p_session jsonb
)
returns public.rental_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_station_id text := nullif(p_session->>'station_id', '');
  v_slot_num integer := nullif(p_session->>'selected_slot_num', '')::integer;
  v_battery_id text := nullif(p_session->>'battery_id', '');
  v_expires_at timestamptz := nullif(p_session->>'expires_at', '')::timestamptz;
  v_session public.rental_sessions;
begin
  if v_station_id is null or v_slot_num is null or v_slot_num < 1 or v_expires_at is null then
    raise exception 'INVALID_SLOT_RESERVATION_PAYLOAD' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_station_id || ':' || v_slot_num::text, 0));

  update public.station_slot_reservations
  set state = 'expired', released_at = now(), release_reason = 'reservation_ttl', updated_at = now()
  where station_id = v_station_id
    and slot_num = v_slot_num
    and state = 'reserved'
    and expires_at <= now();

  if exists (
    select 1 from public.station_slot_reservations
    where station_id = v_station_id and slot_num = v_slot_num and state = 'reserved'
  ) then
    raise exception 'SLOT_ALREADY_RESERVED' using errcode = 'P0001';
  end if;

  insert into public.rental_sessions (
    station_id, cabinet_id, shop_id, kiosk_device_id,
    price_profile_id, price_profile_version, pricing_snapshot, pricing_snapshot_hash,
    state, public_session_code, amount, amount_expected, currency,
    selected_slot_num, battery_id, customer_language, idempotency_key, expires_at
  ) values (
    v_station_id,
    nullif(p_session->>'cabinet_id', ''),
    nullif(p_session->>'shop_id', ''),
    nullif(p_session->>'kiosk_device_id', ''),
    nullif(p_session->>'price_profile_id', ''),
    nullif(p_session->>'price_profile_version', '')::integer,
    coalesce(p_session->'pricing_snapshot', '{}'::jsonb),
    nullif(p_session->>'pricing_snapshot_hash', ''),
    'created',
    nullif(p_session->>'public_session_code', ''),
    nullif(p_session->>'amount', '')::numeric,
    nullif(p_session->>'amount_expected', '')::numeric,
    coalesce(nullif(p_session->>'currency', ''), 'CHF'),
    v_slot_num,
    v_battery_id,
    coalesce(nullif(p_session->>'customer_language', ''), 'fr'),
    nullif(p_session->>'idempotency_key', ''),
    v_expires_at
  ) returning * into v_session;

  -- trg_ensure_inserted_rental_slot_reservation writes the reservation in this
  -- same transaction. A unique-slot violation aborts the session insert too.
  return v_session;
end;
$$;

revoke all on function public.create_reserved_kiosk_rental_session(jsonb)
  from public, anon, authenticated;
grant execute on function public.create_reserved_kiosk_rental_session(jsonb)
  to service_role;

-- The staging one-time hardware permit is the only permitted backward-looking
-- resume from needs_support into ejecting. Enforce that exception in the DB so
-- the monotone trigger and the existing ejection function agree.
create or replace function public.enforce_rental_session_state_machine()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_scoped_resume boolean := false;
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
