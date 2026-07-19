-- Exact ChargeNow callback correlation and retryable inbox.

alter table public.rental_sessions
  add column if not exists return_station_id text,
  add column if not exists returned_slot_num integer,
  add column if not exists return_external_event_id text;

create unique index if not exists rental_sessions_return_external_event_uidx
  on public.rental_sessions(return_external_event_id)
  where return_external_event_id is not null;

create index if not exists rental_sessions_active_battery_idx
  on public.rental_sessions(battery_id, state)
  where battery_id is not null;

-- Claim one supplier event while permitting failed or stale deliveries to retry.
-- The underlying inbox is part of the Rental Orchestrator persistence layer.
create or replace function public.claim_rental_external_event(
  p_source text,
  p_external_event_id text,
  p_rental_id uuid,
  p_event_type text,
  p_payload jsonb,
  p_lock_ttl_minutes integer default 10
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.rental_orchestrator_external_events;
  v_inserted boolean := false;
begin
  if p_source not in ('stripe', 'chargenow', 'kiosk', 'admin', 'system') then
    raise exception using errcode = '22023', message = 'INVALID_EXTERNAL_EVENT_SOURCE';
  end if;
  if nullif(trim(p_external_event_id), '') is null then
    raise exception using errcode = '22023', message = 'MISSING_EXTERNAL_EVENT_ID';
  end if;
  if p_lock_ttl_minutes < 1 or p_lock_ttl_minutes > 120 then
    raise exception using errcode = '22023', message = 'INVALID_LOCK_TTL';
  end if;

  begin
    insert into public.rental_orchestrator_external_events (
      source,
      external_event_id,
      rental_id,
      event_type,
      payload,
      received_at,
      processed_at,
      processing_error,
      attempt_count
    ) values (
      p_source,
      p_external_event_id,
      p_rental_id,
      p_event_type,
      coalesce(p_payload, '{}'::jsonb),
      now(),
      null,
      'PROCESSING',
      1
    );
    v_inserted := true;
  exception when unique_violation then
    v_inserted := false;
  end;

  if v_inserted then
    return 'claimed';
  end if;

  select * into v_event
  from public.rental_orchestrator_external_events
  where source = p_source and external_event_id = p_external_event_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'EXTERNAL_EVENT_NOT_FOUND';
  end if;

  if v_event.processed_at is not null then
    return 'duplicate';
  end if;

  if v_event.processing_error = 'PROCESSING'
     and v_event.received_at >= now() - make_interval(mins => p_lock_ttl_minutes) then
    return 'in_progress';
  end if;

  update public.rental_orchestrator_external_events
  set rental_id = coalesce(p_rental_id, rental_id),
      event_type = p_event_type,
      payload = coalesce(p_payload, '{}'::jsonb),
      received_at = now(),
      processing_error = 'PROCESSING',
      attempt_count = attempt_count + 1
  where id = v_event.id;

  return 'claimed';
end;
$$;

create or replace function public.finish_rental_external_event(
  p_source text,
  p_external_event_id text,
  p_succeeded boolean,
  p_error_code text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.rental_orchestrator_external_events
  set processed_at = case when p_succeeded then now() else null end,
      processing_error = case
        when p_succeeded then null
        else left(coalesce(p_error_code, 'UNKNOWN_ERROR'), 200)
      end
  where source = p_source and external_event_id = p_external_event_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'EXTERNAL_EVENT_NOT_FOUND';
  end if;
end;
$$;

revoke all on function public.claim_rental_external_event(text, text, uuid, text, jsonb, integer)
  from public, anon, authenticated;
revoke all on function public.finish_rental_external_event(text, text, boolean, text)
  from public, anon, authenticated;
grant execute on function public.claim_rental_external_event(text, text, uuid, text, jsonb, integer)
  to service_role;
grant execute on function public.finish_rental_external_event(text, text, boolean, text)
  to service_role;

comment on function public.claim_rental_external_event(text, text, uuid, text, jsonb, integer) is
  'Claims an orchestrator external event once while allowing failed/stale retries; service_role only.';
