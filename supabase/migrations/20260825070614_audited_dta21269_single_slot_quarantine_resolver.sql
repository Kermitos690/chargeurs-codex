-- DTA21269 may only leave this specific quarantine when a persisted,
-- independently reconciled single-slot rental proves the supplier contract.
-- This migration never creates a supplier order, payment, or hardware command.

create table if not exists public.station_hardware_quarantine_resolution_audits (
  id uuid primary key default gen_random_uuid(),
  station_id text not null references public.stations(station_id) on update cascade on delete restrict,
  quarantine_reason_code text not null,
  source_rental_session_id uuid references public.rental_sessions(id) on update cascade on delete set null,
  proof_rental_session_id uuid not null references public.rental_sessions(id) on update cascade on delete restrict,
  supplier_order_id text,
  supplier_trade_no text not null,
  cabinet_event_ids text[] not null,
  battery_id text not null,
  slot_num integer not null check (slot_num > 0),
  settlement_status text not null,
  previous_state jsonb not null,
  resolution_reason text not null,
  code_sha text not null check (code_sha ~ '^[0-9a-f]{40}$'),
  evidence jsonb not null,
  resolved_by uuid references auth.users(id) on update cascade on delete set null,
  resolved_at timestamptz not null default now(),
  unique (station_id, quarantine_reason_code, proof_rental_session_id)
);

alter table public.station_hardware_quarantine_resolution_audits enable row level security;
revoke all on table public.station_hardware_quarantine_resolution_audits from public, anon, authenticated;
grant select, insert on table public.station_hardware_quarantine_resolution_audits to service_role;

create or replace function public.resolve_dta21269_single_slot_quarantine(
  p_proof_rental_session_id uuid,
  p_resolved_by uuid,
  p_code_sha text,
  p_resolution_reason text
)
returns table (
  resolved boolean,
  already_resolved boolean,
  audit_id uuid,
  cabinet_event_ids text[]
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_quarantine public.station_hardware_quarantines%rowtype;
  v_rental public.rental_sessions%rowtype;
  v_attempt public.hardware_release_attempts%rowtype;
  v_trade_no text;
  v_event_ids text[];
  v_event_count integer;
  v_audit_id uuid;
  v_previous_state jsonb;
begin
  if p_code_sha !~ '^[0-9a-f]{40}$' then
    raise exception using errcode = '22023', message = 'QUARANTINE_RESOLUTION_CODE_SHA_INVALID';
  end if;
  if coalesce(nullif(trim(p_resolution_reason), ''), '') <> 'SUPPLIER_SINGLE_SLOT_RENTAL_CONTRACT_VERIFIED_BY_PERSISTED_PROOF' then
    raise exception using errcode = '22023', message = 'QUARANTINE_RESOLUTION_REASON_INVALID';
  end if;

  select * into v_quarantine
  from public.station_hardware_quarantines
  where station_id = 'DTA21269'
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'QUARANTINE_NOT_FOUND';
  end if;
  if not v_quarantine.active or v_quarantine.reason_code <> 'SUPPLIER_SINGLE_SLOT_RENTAL_CONTRACT_UNVERIFIED' then
    select id, cabinet_event_ids into v_audit_id, v_event_ids
    from public.station_hardware_quarantine_resolution_audits
    where station_id = 'DTA21269'
      and quarantine_reason_code = 'SUPPLIER_SINGLE_SLOT_RENTAL_CONTRACT_UNVERIFIED'
      and proof_rental_session_id = p_proof_rental_session_id
    order by resolved_at desc
    limit 1;
    if v_audit_id is not null then
      return query select false, true, v_audit_id, v_event_ids;
      return;
    end if;
    raise exception using errcode = 'P0001', message = 'QUARANTINE_NOT_ACTIVE_FOR_EXPECTED_REASON';
  end if;

  select * into v_rental
  from public.rental_sessions
  where id = p_proof_rental_session_id
    and station_id = 'DTA21269'
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'QUARANTINE_PROOF_RENTAL_INVALID';
  end if;
  if v_rental.returned_at is null or v_rental.settlement_status <> 'settled' then
    raise exception using errcode = 'P0001', message = 'QUARANTINE_PROOF_RETURN_OR_SETTLEMENT_MISSING';
  end if;

  select * into v_attempt
  from public.hardware_release_attempts
  where rental_session_id = v_rental.id
  for update;
  if not found
     or v_attempt.result <> 'single_release'
     or v_attempt.command_sent_at is null
     or coalesce(array_length(v_attempt.released_slot_nums, 1), 0) <> 1
     or coalesce(array_length(v_attempt.released_battery_ids, 1), 0) <> 1
     or v_attempt.released_slot_nums[1] <> v_rental.selected_slot_num
     or v_attempt.released_battery_ids[1] is distinct from v_rental.battery_id then
    raise exception using errcode = 'P0001', message = 'QUARANTINE_PROOF_RELEASE_ATTEMPT_INVALID';
  end if;

  v_trade_no := coalesce(nullif(v_rental.apifox_trade_no, ''), nullif(v_rental.chargenow_order_id, ''));
  if v_trade_no is null then
    raise exception using errcode = 'P0001', message = 'QUARANTINE_PROOF_SUPPLIER_ORDER_MISSING';
  end if;

  select count(*)::integer, coalesce(array_agg(e.external_event_id order by e.received_at), '{}')
    into v_event_count, v_event_ids
  from public.cabinet_events e
  where e.station_id = 'DTA21269'
    and e.event_type = 'BATTERY_BORROW_OUT'
    and e.received_at >= v_attempt.command_sent_at
    and coalesce(e.payload #>> '{eventData,rentOrderId}', e.payload #>> '{eventData,orderId}', e.payload ->> 'rentOrderId', e.payload ->> 'orderId') = v_trade_no
    and nullif(coalesce(e.payload #>> '{eventData,outSlot}', e.payload ->> 'outSlot'), '')::integer = v_rental.selected_slot_num
    and coalesce(e.payload #>> '{eventData,outBatteryId}', e.payload ->> 'outBatteryId') = v_rental.battery_id;
  if v_event_count <> 1 then
    raise exception using errcode = 'P0001', message = 'QUARANTINE_PROOF_BORROW_OUT_COUNT_INVALID';
  end if;

  v_previous_state := jsonb_build_object(
    'active', v_quarantine.active,
    'reason_code', v_quarantine.reason_code,
    'source_rental_session_id', v_quarantine.source_rental_session_id,
    'details', v_quarantine.details,
    'cleared_at', v_quarantine.cleared_at
  );
  insert into public.station_hardware_quarantine_resolution_audits (
    station_id, quarantine_reason_code, source_rental_session_id, proof_rental_session_id,
    supplier_order_id, supplier_trade_no, cabinet_event_ids, battery_id, slot_num,
    settlement_status, previous_state, resolution_reason, code_sha, evidence, resolved_by
  ) values (
    'DTA21269', v_quarantine.reason_code, v_quarantine.source_rental_session_id, v_rental.id,
    v_rental.chargenow_order_id, v_trade_no, v_event_ids, v_rental.battery_id, v_rental.selected_slot_num,
    v_rental.settlement_status, v_previous_state, p_resolution_reason, p_code_sha,
    jsonb_build_object(
      'hardware_release_attempt_id', v_attempt.id,
      'command_sent_at', v_attempt.command_sent_at,
      'release_result', v_attempt.result,
      'released_slot_nums', v_attempt.released_slot_nums,
      'released_battery_ids', v_attempt.released_battery_ids,
      'returned_at', v_rental.returned_at,
      'settled_at', v_rental.settled_at,
      'physical_commands_generated', 0,
      'verified_at', now()
    ),
    p_resolved_by
  ) returning id into v_audit_id;

  update public.station_hardware_quarantines
  set active = false,
      cleared_at = now(),
      cleared_by = p_resolved_by,
      updated_at = now(),
      details = coalesce(details, '{}'::jsonb) || jsonb_build_object(
        'cleared_reason', p_resolution_reason,
        'resolution_audit_id', v_audit_id,
        'proof_rental_session_id', v_rental.id,
        'proof_cabinet_event_ids', v_event_ids,
        'physical_commands_generated', 0
      )
  where station_id = 'DTA21269'
    and active = true
    and reason_code = 'SUPPLIER_SINGLE_SLOT_RENTAL_CONTRACT_UNVERIFIED';
  if not found then
    raise exception using errcode = 'P0001', message = 'QUARANTINE_RESOLUTION_RACE_DETECTED';
  end if;

  insert into public.audit_logs(actor, action, target, data)
  values (
    p_resolved_by,
    'station_quarantine.resolved_from_persisted_single_slot_proof',
    'DTA21269',
    jsonb_build_object('audit_id', v_audit_id, 'proof_rental_session_id', v_rental.id, 'cabinet_event_ids', v_event_ids, 'code_sha', p_code_sha, 'physical_commands_generated', 0)
  );

  return query select true, false, v_audit_id, v_event_ids;
end;
$function$;

revoke all on function public.resolve_dta21269_single_slot_quarantine(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.resolve_dta21269_single_slot_quarantine(uuid, uuid, text, text) to service_role;
