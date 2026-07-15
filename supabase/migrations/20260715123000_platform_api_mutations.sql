-- Chargeurs.ch Platform API v1.1 — safe mutation foundation.
-- Adds API ownership on rentals, request idempotency and a transactional
-- rental creation function that initializes the Rental Orchestrator snapshot.

alter table public.rental_sessions
  add column if not exists created_via text not null default 'kiosk',
  add column if not exists api_client_id uuid references public.api_clients(id) on delete set null,
  add column if not exists api_key_id uuid references public.api_keys(id) on delete set null,
  add column if not exists external_reference text;

alter table public.rental_sessions
  drop constraint if exists rental_sessions_created_via_check;
alter table public.rental_sessions
  add constraint rental_sessions_created_via_check
  check (created_via in ('kiosk', 'platform_api', 'admin', 'system'));

create index if not exists rental_sessions_api_client_created_idx
  on public.rental_sessions(api_client_id, created_at desc)
  where api_client_id is not null;

create unique index if not exists rental_sessions_api_client_external_ref_uidx
  on public.rental_sessions(api_client_id, external_reference)
  where api_client_id is not null and external_reference is not null;

-- The orchestrator's external inbox initially predated the Platform API.
alter table public.rental_orchestrator_external_events
  drop constraint if exists rental_orchestrator_external_events_source_check;
alter table public.rental_orchestrator_external_events
  add constraint rental_orchestrator_external_events_source_check
  check (source in ('stripe', 'chargenow', 'kiosk', 'admin', 'system', 'api'));

create table if not exists public.api_idempotency_records (
  id uuid primary key default gen_random_uuid(),
  key_id uuid not null references public.api_keys(id) on delete cascade,
  client_id uuid not null references public.api_clients(id) on delete cascade,
  idempotency_key text not null check (length(idempotency_key) between 8 and 128),
  method text not null,
  path text not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'processing' check (status in ('processing', 'completed')),
  response_status integer check (response_status is null or response_status between 100 and 599),
  response_body jsonb,
  resource_type text,
  resource_id text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  constraint api_idempotency_records_key_unique unique (key_id, idempotency_key)
);

create index if not exists api_idempotency_records_expiry_idx
  on public.api_idempotency_records(expires_at);
create index if not exists api_idempotency_records_client_created_idx
  on public.api_idempotency_records(client_id, created_at desc);

alter table public.api_idempotency_records enable row level security;
revoke all on public.api_idempotency_records from public, anon, authenticated;
grant all on public.api_idempotency_records to service_role;

create or replace function public.create_platform_api_rental_session(
  p_station_id text,
  p_cabinet_id text,
  p_shop_id text,
  p_api_client_id uuid,
  p_api_key_id uuid,
  p_external_reference text,
  p_customer_email text,
  p_customer_language text,
  p_idempotency_key text,
  p_public_session_code text,
  p_price_profile_id uuid,
  p_price_profile_version integer,
  p_pricing_snapshot jsonb,
  p_pricing_snapshot_hash text,
  p_amount numeric,
  p_currency text,
  p_expires_at timestamptz
)
returns public.rental_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.rental_sessions;
begin
  if p_station_id is null or length(trim(p_station_id)) < 4 then
    raise exception using errcode = '22023', message = 'INVALID_STATION_ID';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception using errcode = '22023', message = 'INVALID_AMOUNT';
  end if;
  if p_pricing_snapshot is null or p_pricing_snapshot_hash is null then
    raise exception using errcode = '22023', message = 'PRICING_SNAPSHOT_REQUIRED';
  end if;

  insert into public.rental_sessions (
    station_id,
    cabinet_id,
    shop_id,
    api_client_id,
    api_key_id,
    external_reference,
    created_via,
    customer_email,
    customer_language,
    idempotency_key,
    public_session_code,
    price_profile_id,
    price_profile_version,
    pricing_snapshot,
    pricing_snapshot_hash,
    state,
    amount,
    amount_expected,
    currency,
    expires_at
  ) values (
    p_station_id,
    coalesce(nullif(p_cabinet_id, ''), p_station_id),
    nullif(p_shop_id, ''),
    p_api_client_id,
    p_api_key_id,
    nullif(trim(p_external_reference), ''),
    'platform_api',
    nullif(lower(trim(p_customer_email)), ''),
    coalesce(nullif(trim(p_customer_language), ''), 'fr'),
    p_idempotency_key,
    p_public_session_code,
    p_price_profile_id,
    p_price_profile_version,
    p_pricing_snapshot,
    p_pricing_snapshot_hash,
    'created',
    p_amount,
    p_amount,
    upper(coalesce(nullif(p_currency, ''), 'CHF')),
    p_expires_at
  ) returning * into v_session;

  insert into public.rental_orchestrator_snapshots (
    rental_id, state, version, station_id, final_amount_chf
  ) values (
    v_session.id, 'created', 0, p_station_id, p_amount
  ) on conflict (rental_id) do nothing;

  insert into public.rental_orchestrator_external_events (
    source, external_event_id, rental_id, event_type, payload, processed_at
  ) values (
    'api',
    p_idempotency_key,
    v_session.id,
    'rental.created',
    jsonb_build_object(
      'api_client_id', p_api_client_id,
      'api_key_id', p_api_key_id,
      'external_reference', nullif(trim(p_external_reference), ''),
      'station_id', p_station_id
    ),
    now()
  ) on conflict (source, external_event_id) do nothing;

  return v_session;
end;
$$;

revoke execute on function public.create_platform_api_rental_session(
  text, text, text, uuid, uuid, text, text, text, text, text,
  uuid, integer, jsonb, text, numeric, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.create_platform_api_rental_session(
  text, text, text, uuid, uuid, text, text, text, text, text,
  uuid, integer, jsonb, text, numeric, text, timestamptz
) to service_role;

create or replace function public.prune_platform_api_operational_data(
  p_log_retention_days integer default 90,
  p_rate_limit_retention_hours integer default 24
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_logs integer;
  v_windows integer;
  v_idempotency integer;
begin
  delete from public.api_request_logs
  where created_at < now() - make_interval(days => greatest(1, p_log_retention_days));
  get diagnostics v_logs = row_count;

  delete from public.api_rate_limit_windows
  where window_started_at < now() - make_interval(hours => greatest(1, p_rate_limit_retention_hours));
  get diagnostics v_windows = row_count;

  delete from public.api_idempotency_records
  where expires_at < now();
  get diagnostics v_idempotency = row_count;

  return jsonb_build_object(
    'deleted_logs', v_logs,
    'deleted_rate_limit_windows', v_windows,
    'deleted_idempotency_records', v_idempotency
  );
end;
$$;

revoke execute on function public.prune_platform_api_operational_data(integer, integer)
  from public, anon, authenticated;
grant execute on function public.prune_platform_api_operational_data(integer, integer)
  to service_role;

comment on table public.api_idempotency_records is
  'Server-only replay records for Platform API mutations. No raw API keys or authorization headers are stored.';