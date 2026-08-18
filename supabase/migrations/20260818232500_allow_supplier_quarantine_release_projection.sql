-- P0 staging safety repair.
--
-- A paid TEST rental on DTA21269 reached Stripe authorization, but the
-- orchestrator failed before the business-level hardware quarantine handler
-- could persist its explicit needs_support result. The regression came from
-- blocking `release_requested` inside the atomic orchestrator function for any
-- active station quarantine.
--
-- `release_requested` is a state-machine projection only; it does not issue a
-- supplier command. Keep the database fail-closed for all other quarantine
-- reasons and for `test_ejection_resumed`, while allowing the specific
-- SUPPLIER_SINGLE_SLOT_RENTAL_CONTRACT_UNVERIFIED quarantine to flow into
-- eject-after-payment's business gate. That gate remains responsible for
-- returning needs_support with hardware_command_issued=false.

create or replace function public.append_rental_orchestrator_event(
  p_rental_id uuid,
  p_expected_version bigint,
  p_event_type text,
  p_idempotency_key text,
  p_occurred_at timestamptz,
  p_metadata jsonb,
  p_resulting_state text,
  p_payment_intent_id text default null,
  p_station_id text default null,
  p_battery_id text default null,
  p_final_amount_chf numeric default null,
  p_failure_reason text default null
)
returns public.rental_orchestrator_snapshots
language plpgsql
security definer
set search_path = public
as $$
declare
  v_snapshot public.rental_orchestrator_snapshots;
  v_existing public.rental_orchestrator_events;
  v_effective_station text;
begin
  select * into v_snapshot
  from public.rental_orchestrator_snapshots
  where rental_id = p_rental_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'RENTAL_NOT_FOUND';
  end if;

  select * into v_existing
  from public.rental_orchestrator_events
  where rental_id = p_rental_id
    and idempotency_key = p_idempotency_key;

  if found then
    if v_existing.event_type <> p_event_type then
      raise exception using errcode = '23505', message = 'IDEMPOTENCY_KEY_CONFLICT';
    end if;
    return v_snapshot;
  end if;

  if v_snapshot.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'VERSION_CONFLICT';
  end if;

  v_effective_station := coalesce(nullif(p_station_id, ''), v_snapshot.station_id);

  -- `test_ejection_resumed` is an explicit hardware-resume transition and must
  -- always remain blocked while any station quarantine is active.
  if p_event_type = 'test_ejection_resumed'
     and exists (
       select 1
       from public.station_hardware_quarantines q
       where q.station_id = v_effective_station
         and q.active = true
     ) then
    raise exception using errcode = 'P0001', message = 'STATION_HARDWARE_QUARANTINED';
  end if;

  -- `release_requested` itself is projection-only. Permit it only when every
  -- active quarantine on the station is the known supplier single-slot gate.
  -- eject-after-payment then persists the explicit fail-closed business result
  -- before any provider command can be issued.
  if p_event_type = 'release_requested'
     and exists (
       select 1
       from public.station_hardware_quarantines q
       where q.station_id = v_effective_station
         and q.active = true
         and q.reason_code <> 'SUPPLIER_SINGLE_SLOT_RENTAL_CONTRACT_UNVERIFIED'
     ) then
    raise exception using errcode = 'P0001', message = 'STATION_HARDWARE_QUARANTINED';
  end if;

  if p_event_type in ('battery_released', 'rental_activated')
     and not exists (
       select 1
       from public.hardware_release_attempts h
       where h.rental_session_id = p_rental_id
         and (
           h.result = 'single_release'
           or (
             h.result = 'multi_release'
             and h.selected_slot_num = any(coalesce(h.released_slot_nums, '{}'::integer[]))
             and h.expected_battery_id = any(coalesce(h.released_battery_ids, '{}'::text[]))
           )
         )
     ) then
    raise exception using errcode = 'P0001', message = 'PHYSICAL_RELEASE_NOT_CONFIRMED';
  end if;

  update public.rental_orchestrator_snapshots
  set state = p_resulting_state,
      version = version + 1,
      payment_intent_id = coalesce(p_payment_intent_id, payment_intent_id),
      station_id = coalesce(p_station_id, station_id),
      battery_id = coalesce(p_battery_id, battery_id),
      final_amount_chf = coalesce(p_final_amount_chf, final_amount_chf),
      failure_reason = coalesce(p_failure_reason, failure_reason)
  where rental_id = p_rental_id
  returning * into v_snapshot;

  insert into public.rental_orchestrator_events(
    rental_id, event_type, idempotency_key, occurred_at, metadata,
    resulting_state, resulting_version
  ) values (
    p_rental_id, p_event_type, p_idempotency_key, p_occurred_at,
    coalesce(p_metadata, '{}'::jsonb), p_resulting_state, v_snapshot.version
  );

  return v_snapshot;
end;
$$;

revoke all on function public.append_rental_orchestrator_event(
  uuid, bigint, text, text, timestamptz, jsonb, text, text, text, text, numeric, text
) from public;
