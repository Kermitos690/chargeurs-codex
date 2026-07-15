-- Chargeurs.ch Platform API v1.
-- Stores API clients, hashed keys, rate-limit windows and redacted request logs.
-- Raw API keys are never persisted: api-key-admin returns them once at creation.

create extension if not exists pgcrypto;

create table if not exists public.api_clients (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 120),
  environment text not null default 'test' check (environment in ('test', 'live')),
  active boolean not null default true,
  contact_email text,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists api_clients_environment_active_idx
  on public.api_clients(environment, active, created_at desc);

create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.api_clients(id) on delete cascade,
  name text not null default 'Default key',
  key_prefix text not null,
  key_hash text not null unique,
  scopes text[] not null default array[]::text[],
  rate_limit_per_minute integer not null default 120 check (rate_limit_per_minute between 1 and 10000),
  active boolean not null default true,
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint api_keys_prefix_format check (key_prefix ~ '^chg_(test|live)_[A-Za-z0-9_-]{4,24}$')
);

create index if not exists api_keys_client_active_idx
  on public.api_keys(client_id, active, created_at desc);
create index if not exists api_keys_prefix_idx
  on public.api_keys(key_prefix);

create table if not exists public.api_rate_limit_windows (
  key_id uuid not null references public.api_keys(id) on delete cascade,
  window_started_at timestamptz not null,
  requests integer not null default 0 check (requests >= 0),
  updated_at timestamptz not null default now(),
  primary key (key_id, window_started_at)
);

create index if not exists api_rate_limit_windows_cleanup_idx
  on public.api_rate_limit_windows(window_started_at);

create table if not exists public.api_request_logs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  client_id uuid references public.api_clients(id) on delete set null,
  key_id uuid references public.api_keys(id) on delete set null,
  environment text check (environment in ('test', 'live')),
  method text not null,
  path text not null,
  status_code integer not null check (status_code between 100 and 599),
  duration_ms integer not null default 0 check (duration_ms >= 0),
  error_code text,
  ip_hash text,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists api_request_logs_created_idx
  on public.api_request_logs(created_at desc);
create index if not exists api_request_logs_client_created_idx
  on public.api_request_logs(client_id, created_at desc);
create index if not exists api_request_logs_status_created_idx
  on public.api_request_logs(status_code, created_at desc);

create or replace function public.touch_api_client_updated_at()
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

drop trigger if exists trg_touch_api_client_updated_at on public.api_clients;
create trigger trg_touch_api_client_updated_at
before update on public.api_clients
for each row execute function public.touch_api_client_updated_at();

create or replace function public.consume_platform_api_quota(
  p_key_id uuid,
  p_limit integer,
  p_window_seconds integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window timestamptz;
  v_count integer;
  v_reset timestamptz;
begin
  if p_limit < 1 or p_window_seconds < 1 then
    raise exception using errcode = '22023', message = 'INVALID_RATE_LIMIT';
  end if;

  v_window := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );
  v_reset := v_window + make_interval(secs => p_window_seconds);

  insert into public.api_rate_limit_windows(key_id, window_started_at, requests, updated_at)
  values (p_key_id, v_window, 1, now())
  on conflict (key_id, window_started_at)
  do update set requests = public.api_rate_limit_windows.requests + 1, updated_at = now()
  returning requests into v_count;

  return jsonb_build_object(
    'allowed', v_count <= p_limit,
    'limit', p_limit,
    'used', v_count,
    'remaining', greatest(0, p_limit - v_count),
    'reset_at', v_reset
  );
end;
$$;

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
begin
  delete from public.api_request_logs
  where created_at < now() - make_interval(days => greatest(1, p_log_retention_days));
  get diagnostics v_logs = row_count;

  delete from public.api_rate_limit_windows
  where window_started_at < now() - make_interval(hours => greatest(1, p_rate_limit_retention_hours));
  get diagnostics v_windows = row_count;

  return jsonb_build_object('deleted_logs', v_logs, 'deleted_rate_limit_windows', v_windows);
end;
$$;

alter table public.api_clients enable row level security;
alter table public.api_keys enable row level security;
alter table public.api_rate_limit_windows enable row level security;
alter table public.api_request_logs enable row level security;

revoke all on public.api_clients from public, anon, authenticated;
revoke all on public.api_keys from public, anon, authenticated;
revoke all on public.api_rate_limit_windows from public, anon, authenticated;
revoke all on public.api_request_logs from public, anon, authenticated;

revoke execute on function public.consume_platform_api_quota(uuid, integer, integer) from public, anon, authenticated;
revoke execute on function public.prune_platform_api_operational_data(integer, integer) from public, anon, authenticated;

grant all on public.api_clients to service_role;
grant all on public.api_keys to service_role;
grant all on public.api_rate_limit_windows to service_role;
grant all on public.api_request_logs to service_role;
grant execute on function public.consume_platform_api_quota(uuid, integer, integer) to service_role;
grant execute on function public.prune_platform_api_operational_data(integer, integer) to service_role;

comment on table public.api_keys is 'Hashed Chargeurs.ch API keys. Raw values are returned once and never stored.';
comment on table public.api_request_logs is 'Redacted operational API logs; never store authorization headers, raw keys or payment secrets.';