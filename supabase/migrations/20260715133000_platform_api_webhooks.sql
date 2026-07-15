-- Chargeurs.ch Platform API webhooks.
-- Endpoints store only a public rotation nonce. The delivery secret is derived
-- at runtime from a deployment master secret and is never persisted in raw form.

create table if not exists public.api_webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.api_clients(id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 120),
  target_url text not null check (target_url ~ '^https://'),
  event_types text[] not null default array['*']::text[],
  active boolean not null default true,
  secret_nonce uuid not null default gen_random_uuid(),
  failure_count integer not null default 0 check (failure_count >= 0),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint api_webhook_endpoints_client_url_unique unique (client_id, target_url)
);

create index if not exists api_webhook_endpoints_client_active_idx
  on public.api_webhook_endpoints(client_id, active, created_at desc);

create table if not exists public.api_webhook_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.api_clients(id) on delete cascade,
  event_type text not null,
  resource_type text,
  resource_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists api_webhook_events_client_created_idx
  on public.api_webhook_events(client_id, created_at desc);
create index if not exists api_webhook_events_type_created_idx
  on public.api_webhook_events(event_type, created_at desc);

create table if not exists public.api_webhook_jobs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.api_webhook_events(id) on delete cascade,
  endpoint_id uuid not null references public.api_webhook_endpoints(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'processing', 'delivered', 'dead')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint api_webhook_jobs_event_endpoint_unique unique (event_id, endpoint_id)
);

create index if not exists api_webhook_jobs_due_idx
  on public.api_webhook_jobs(next_attempt_at, created_at)
  where status in ('pending', 'processing');
create index if not exists api_webhook_jobs_endpoint_created_idx
  on public.api_webhook_jobs(endpoint_id, created_at desc);

create table if not exists public.api_webhook_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.api_webhook_jobs(id) on delete cascade,
  attempt_number integer not null check (attempt_number > 0),
  status_code integer check (status_code is null or status_code between 100 and 599),
  duration_ms integer not null default 0 check (duration_ms >= 0),
  success boolean not null,
  error_code text,
  response_hash text,
  created_at timestamptz not null default now(),
  constraint api_webhook_attempts_job_attempt_unique unique (job_id, attempt_number)
);

create index if not exists api_webhook_attempts_job_created_idx
  on public.api_webhook_attempts(job_id, created_at desc);

create or replace function public.touch_platform_webhook_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_touch_api_webhook_endpoint
before update on public.api_webhook_endpoints
for each row execute function public.touch_platform_webhook_updated_at();

create trigger trg_touch_api_webhook_job
before update on public.api_webhook_jobs
for each row execute function public.touch_platform_webhook_updated_at();

create or replace function public.enqueue_platform_api_webhook_event(
  p_client_id uuid,
  p_event_type text,
  p_resource_type text,
  p_resource_id text,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
begin
  if p_client_id is null or p_event_type is null or length(trim(p_event_type)) = 0 then
    raise exception using errcode = '22023', message = 'INVALID_WEBHOOK_EVENT';
  end if;

  insert into public.api_webhook_events (
    client_id, event_type, resource_type, resource_id, payload
  ) values (
    p_client_id, trim(p_event_type), nullif(trim(p_resource_type), ''),
    nullif(trim(p_resource_id), ''), coalesce(p_payload, '{}'::jsonb)
  ) returning id into v_event_id;

  insert into public.api_webhook_jobs (event_id, endpoint_id)
  select v_event_id, endpoint.id
  from public.api_webhook_endpoints endpoint
  where endpoint.client_id = p_client_id
    and endpoint.active = true
    and ('*' = any(endpoint.event_types) or p_event_type = any(endpoint.event_types))
  on conflict (event_id, endpoint_id) do nothing;

  return v_event_id;
end;
$$;

create or replace function public.claim_platform_api_webhook_jobs(
  p_limit integer,
  p_worker_id text,
  p_stale_after_seconds integer default 300
)
returns table (
  job_id uuid,
  attempt_count integer,
  endpoint_id uuid,
  target_url text,
  secret_nonce uuid,
  event_id uuid,
  event_type text,
  event_created_at timestamptz,
  resource_type text,
  resource_id text,
  payload jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select job.id
    from public.api_webhook_jobs job
    join public.api_webhook_endpoints endpoint on endpoint.id = job.endpoint_id
    where endpoint.active = true
      and (
        (job.status = 'pending' and job.next_attempt_at <= now())
        or
        (job.status = 'processing' and job.locked_at < now() - make_interval(secs => greatest(30, p_stale_after_seconds)))
      )
    order by job.next_attempt_at, job.created_at
    for update of job skip locked
    limit greatest(1, least(100, p_limit))
  ), claimed as (
    update public.api_webhook_jobs job
    set status = 'processing',
        locked_at = now(),
        locked_by = left(p_worker_id, 200),
        attempt_count = job.attempt_count + 1,
        updated_at = now()
    from candidates
    where job.id = candidates.id
    returning job.*
  )
  select
    claimed.id,
    claimed.attempt_count,
    endpoint.id,
    endpoint.target_url,
    endpoint.secret_nonce,
    event.id,
    event.event_type,
    event.created_at,
    event.resource_type,
    event.resource_id,
    event.payload
  from claimed
  join public.api_webhook_endpoints endpoint on endpoint.id = claimed.endpoint_id
  join public.api_webhook_events event on event.id = claimed.event_id;
end;
$$;

create or replace function public.emit_rental_platform_api_webhook()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_type text;
  v_payload jsonb;
begin
  if new.api_client_id is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_event_type := 'rental.created';
  elsif old.state is not distinct from new.state then
    return new;
  else
    v_event_type := case new.state
      when 'checkout_created' then 'rental.checkout_created'
      when 'payment_succeeded' then 'rental.payment_succeeded'
      when 'ejected' then 'rental.ejected'
      when 'battery_taken' then 'rental.active'
      when 'active_rental' then 'rental.active'
      when 'battery_returned' then 'rental.returned'
      when 'returned' then 'rental.returned'
      when 'closed' then 'rental.completed'
      when 'completed' then 'rental.completed'
      when 'payment_cancelled' then 'rental.cancelled'
      when 'cancelled' then 'rental.cancelled'
      when 'refunded' then 'rental.refunded'
      when 'needs_support' then 'rental.incident'
      when 'eject_failed' then 'rental.incident'
      else 'rental.state_changed'
    end;
  end if;

  v_payload := jsonb_build_object(
    'rentalId', new.id,
    'publicSessionCode', new.public_session_code,
    'externalReference', new.external_reference,
    'stationId', new.station_id,
    'state', new.state,
    'previousState', case when tg_op = 'UPDATE' then old.state else null end,
    'currency', new.currency,
    'amountExpected', new.amount_expected,
    'amountPaid', new.amount_paid,
    'failureCode', new.failure_code,
    'startedAt', new.started_at,
    'returnedAt', new.returned_at,
    'closedAt', new.closed_at,
    'updatedAt', new.updated_at
  );

  perform public.enqueue_platform_api_webhook_event(
    new.api_client_id,
    v_event_type,
    'rental',
    new.id::text,
    v_payload
  );
  return new;
end;
$$;

create trigger trg_emit_rental_platform_api_webhook
  after insert or update of state on public.rental_sessions
  for each row execute function public.emit_rental_platform_api_webhook();

alter table public.api_webhook_endpoints enable row level security;
alter table public.api_webhook_events enable row level security;
alter table public.api_webhook_jobs enable row level security;
alter table public.api_webhook_attempts enable row level security;

revoke all on public.api_webhook_endpoints from public, anon, authenticated;
revoke all on public.api_webhook_events from public, anon, authenticated;
revoke all on public.api_webhook_jobs from public, anon, authenticated;
revoke all on public.api_webhook_attempts from public, anon, authenticated;

revoke execute on function public.enqueue_platform_api_webhook_event(uuid, text, text, text, jsonb)
  from public, anon, authenticated;
revoke execute on function public.claim_platform_api_webhook_jobs(integer, text, integer)
  from public, anon, authenticated;

grant all on public.api_webhook_endpoints to service_role;
grant all on public.api_webhook_events to service_role;
grant all on public.api_webhook_jobs to service_role;
grant all on public.api_webhook_attempts to service_role;
grant execute on function public.enqueue_platform_api_webhook_event(uuid, text, text, text, jsonb)
  to service_role;
grant execute on function public.claim_platform_api_webhook_jobs(integer, text, integer)
  to service_role;

comment on table public.api_webhook_endpoints is
  'Platform API webhook destinations. Raw signing secrets are derived at runtime and never stored.';
comment on table public.api_webhook_attempts is
  'Redacted webhook delivery attempts. Response bodies are never stored.';
