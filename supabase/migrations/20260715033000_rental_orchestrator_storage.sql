-- Rental Orchestrator persistence layer.
-- This migration is intentionally additive and does not modify legacy rental tables.

create extension if not exists pgcrypto;

create table if not exists public.rental_orchestrator_snapshots (
  rental_id uuid primary key default gen_random_uuid(),
  state text not null default 'created' check (state in (
    'created', 'payment_pending', 'authorized', 'release_requested', 'released',
    'active', 'return_detected', 'pricing_finalized', 'payment_captured',
    'refunded', 'completed', 'failed', 'non_return'
  )),
  version bigint not null default 0 check (version >= 0),
  payment_intent_id text,
  station_id text,
  battery_id text,
  final_amount_chf numeric(10,2) check (final_amount_chf is null or final_amount_chf >= 0),
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists rental_orchestrator_snapshots_payment_intent_uidx
  on public.rental_orchestrator_snapshots(payment_intent_id)
  where payment_intent_id is not null;

create index if not exists rental_orchestrator_snapshots_state_idx
  on public.rental_orchestrator_snapshots(state, updated_at desc);

create table if not exists public.rental_orchestrator_events (
  id uuid primary key default gen_random_uuid(),
  rental_id uuid not null references public.rental_orchestrator_snapshots(rental_id) on delete cascade,
  event_type text not null,
  idempotency_key text not null,
  occurred_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  resulting_state text not null,
  resulting_version bigint not null check (resulting_version > 0),
  created_at timestamptz not null default now(),
  constraint rental_orchestrator_events_idempotency_unique unique (rental_id, idempotency_key),
  constraint rental_orchestrator_events_version_unique unique (rental_id, resulting_version)
);

create index if not exists rental_orchestrator_events_rental_created_idx
  on public.rental_orchestrator_events(rental_id, created_at);

create index if not exists rental_orchestrator_events_type_idx
  on public.rental_orchestrator_events(event_type, created_at desc);

create table if not exists public.rental_orchestrator_external_events (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('stripe', 'chargenow', 'kiosk', 'admin', 'system')),
  external_event_id text not null,
  rental_id uuid references public.rental_orchestrator_snapshots(rental_id) on delete set null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  constraint rental_orchestrator_external_events_source_event_unique unique (source, external_event_id)
);

create index if not exists rental_orchestrator_external_events_pending_idx
  on public.rental_orchestrator_external_events(received_at)
  where processed_at is null;

create table if not exists public.rental_orchestrator_incidents (
  id uuid primary key default gen_random_uuid(),
  rental_id uuid references public.rental_orchestrator_snapshots(rental_id) on delete set null,
  code text not null,
  severity text not null check (severity in ('info', 'warning', 'critical')),
  status text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
  message text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz
);

create index if not exists rental_orchestrator_incidents_open_idx
  on public.rental_orchestrator_incidents(severity, created_at desc)
  where status <> 'resolved';

create or replace function public.touch_rental_orchestrator_snapshot_updated_at()
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

drop trigger if exists trg_touch_rental_orchestrator_snapshot on public.rental_orchestrator_snapshots;
create trigger trg_touch_rental_orchestrator_snapshot
before update on public.rental_orchestrator_snapshots
for each row execute function public.touch_rental_orchestrator_snapshot_updated_at();

-- Atomic compare-and-swap append. Business transition validation remains in the
-- server-side orchestrator; this function guarantees serialization, idempotence
-- and optimistic concurrency at the database boundary.
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
  where rental_id = p_rental_id and idempotency_key = p_idempotency_key;

  if found then
    if v_existing.event_type <> p_event_type then
      raise exception using errcode = '23505', message = 'IDEMPOTENCY_KEY_CONFLICT';
    end if;
    return v_snapshot;
  end if;

  if v_snapshot.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'VERSION_CONFLICT';
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

  insert into public.rental_orchestrator_events (
    rental_id, event_type, idempotency_key, occurred_at, metadata,
    resulting_state, resulting_version
  ) values (
    p_rental_id, p_event_type, p_idempotency_key, p_occurred_at,
    coalesce(p_metadata, '{}'::jsonb), p_resulting_state, v_snapshot.version
  );

  return v_snapshot;
end;
$$;

alter table public.rental_orchestrator_snapshots enable row level security;
alter table public.rental_orchestrator_events enable row level security;
alter table public.rental_orchestrator_external_events enable row level security;
alter table public.rental_orchestrator_incidents enable row level security;

-- No browser role receives direct table access. Server-side functions must use
-- the service role. Explicit revokes make the boundary visible and auditable.
revoke all on public.rental_orchestrator_snapshots from anon, authenticated;
revoke all on public.rental_orchestrator_events from anon, authenticated;
revoke all on public.rental_orchestrator_external_events from anon, authenticated;
revoke all on public.rental_orchestrator_incidents from anon, authenticated;
revoke execute on function public.append_rental_orchestrator_event(uuid, bigint, text, text, timestamptz, jsonb, text, text, text, text, numeric, text) from public, anon, authenticated;
grant execute on function public.append_rental_orchestrator_event(uuid, bigint, text, text, timestamptz, jsonb, text, text, text, text, numeric, text) to service_role;
