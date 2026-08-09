-- Atomically consume a verified customer pairing together with the rental,
-- the physical-slot reservation and the pre-release cabinet observation.
-- A client-supplied member flag can therefore never obtain the green/member
-- price without a claimed server-side pairing, and every future hardware
-- command has a trustworthy four-slot baseline for multi-release detection.

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
  v_kiosk_device_id uuid := nullif(p_session->>'kiosk_device_id', '')::uuid;
  v_pairing_id uuid := nullif(p_session->>'customer_pairing_session_id', '')::uuid;
  v_customer_user_id uuid := nullif(p_session->>'customer_user_id', '')::uuid;
  v_customer_segment text := coalesce(nullif(p_session->>'customer_segment', ''), 'guest');
  v_pre_release_snapshot jsonb := p_session->'pre_release_snapshot';
  v_baseline_slots integer := 0;
  v_consumed_pairing uuid;
  v_session public.rental_sessions;
begin
  if v_station_id is null or v_slot_num is null or v_slot_num < 1 or v_expires_at is null or v_kiosk_device_id is null then
    raise exception 'INVALID_SLOT_RESERVATION_PAYLOAD' using errcode = 'P0001';
  end if;
  if v_customer_segment not in ('guest','member') then
    raise exception 'INVALID_CUSTOMER_SEGMENT' using errcode = 'P0001';
  end if;
  if v_pre_release_snapshot is null
     or jsonb_typeof(v_pre_release_snapshot) <> 'object'
     or jsonb_typeof(v_pre_release_snapshot->'slots') <> 'array' then
    raise exception 'PRE_RELEASE_SNAPSHOT_REQUIRED' using errcode = 'P0001';
  end if;

  -- Exactly the four DTA compartments must have an unambiguous pre-command
  -- observation. A compartment may be explicitly empty, or explicitly occupied
  -- with a battery id. Low-confidence/conflicting records are not sufficient.
  select count(distinct (slot->>'slot_num')::integer)
    into v_baseline_slots
  from jsonb_array_elements(v_pre_release_snapshot->'slots') slot
  where (slot->>'slot_num') ~ '^[1-4]$'
    and coalesce(slot->>'confidence','low') <> 'low'
    and coalesce(jsonb_array_length(coalesce(slot->'conflicts','[]'::jsonb)), 0) = 0
    and (
      (slot->>'battery_present')::boolean = false
      or (
        (slot->>'battery_present')::boolean = true
        and nullif(slot->>'battery_id','') is not null
      )
    );

  if v_baseline_slots <> 4 then
    raise exception 'HARDWARE_BASELINE_UNSAFE' using errcode = 'P0001';
  end if;

  if v_customer_segment = 'member' then
    if v_pairing_id is null or v_customer_user_id is null then
      raise exception 'MEMBER_PAIRING_REQUIRED' using errcode = 'P0001';
    end if;

    update public.customer_pairing_sessions
    set state = 'consumed', consumed_at = now(), updated_at = now()
    where id = v_pairing_id
      and state = 'claimed'
      and segment = 'member'
      and station_id = v_station_id
      and kiosk_device_id = v_kiosk_device_id
      and customer_user_id = v_customer_user_id
      and consumed_at is null
      and expires_at > now()
    returning id into v_consumed_pairing;

    if v_consumed_pairing is null then
      raise exception 'CUSTOMER_PAIRING_INVALID' using errcode = 'P0001';
    end if;
  elsif v_pairing_id is not null or v_customer_user_id is not null then
    raise exception 'GUEST_PAIRING_CONFLICT' using errcode = 'P0001';
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
    selected_slot_num, battery_id, customer_language, idempotency_key, expires_at,
    customer_user_id, customer_segment, customer_pairing_session_id
  ) values (
    v_station_id,
    nullif(p_session->>'cabinet_id', ''),
    nullif(p_session->>'shop_id', ''),
    v_kiosk_device_id::text,
    nullif(p_session->>'price_profile_id', '')::uuid,
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
    v_expires_at,
    v_customer_user_id,
    v_customer_segment,
    v_pairing_id
  ) returning * into v_session;

  insert into public.hardware_release_attempts(
    rental_session_id, station_id, selected_slot_num, expected_battery_id,
    pre_snapshot, result
  ) values (
    v_session.id, v_station_id, v_slot_num, v_battery_id,
    v_pre_release_snapshot, 'prepared'
  );

  -- trg_ensure_inserted_rental_slot_reservation writes the slot reservation in
  -- this same transaction. A failure in pairing, snapshot or hardware baseline
  -- therefore rolls back the rental too.
  return v_session;
end;
$$;

revoke all on function public.create_reserved_kiosk_rental_session(jsonb)
  from public, anon, authenticated;
grant execute on function public.create_reserved_kiosk_rental_session(jsonb)
  to service_role;
