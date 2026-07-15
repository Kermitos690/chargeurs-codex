-- Atomic claim for Stripe webhook events.
--
-- The legacy webhook inserted an event before processing and returned duplicate
-- on every retry, even when the first handler failed. This function preserves
-- idempotence while allowing failed or stale events to be processed again.

create or replace function public.claim_stripe_webhook_event(
  p_external_id text,
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
  v_event public.webhook_events;
  v_inserted boolean := false;
begin
  if nullif(trim(p_external_id), '') is null then
    raise exception using errcode = '22023', message = 'MISSING_EXTERNAL_EVENT_ID';
  end if;
  if p_lock_ttl_minutes < 1 or p_lock_ttl_minutes > 120 then
    raise exception using errcode = '22023', message = 'INVALID_LOCK_TTL';
  end if;

  begin
    insert into public.webhook_events (
      provider,
      external_id,
      event_type,
      payload,
      processing_status,
      processing_started_at,
      attempt_count
    ) values (
      'stripe',
      p_external_id,
      p_event_type,
      coalesce(p_payload, '{}'::jsonb),
      'processing',
      now(),
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
  from public.webhook_events
  where external_id = p_external_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'WEBHOOK_EVENT_NOT_FOUND';
  end if;

  if v_event.processing_status in ('processed','ignored') then
    return 'duplicate';
  end if;

  if v_event.processing_status = 'processing'
     and v_event.processing_started_at is not null
     and v_event.processing_started_at >= now() - make_interval(mins => p_lock_ttl_minutes) then
    return 'in_progress';
  end if;

  update public.webhook_events
  set processing_status = 'processing',
      processing_started_at = now(),
      processing_error = null,
      event_type = p_event_type,
      payload = coalesce(p_payload, '{}'::jsonb),
      attempt_count = attempt_count + 1
  where id = v_event.id;

  return 'claimed';
end;
$$;

revoke all on function public.claim_stripe_webhook_event(text, text, jsonb, integer)
  from public, anon, authenticated;
grant execute on function public.claim_stripe_webhook_event(text, text, jsonb, integer)
  to service_role;

comment on function public.claim_stripe_webhook_event(text, text, jsonb, integer) is
  'Claims a Stripe event once, allows failed/stale retries and rejects concurrent duplicate processing; service_role only.';
