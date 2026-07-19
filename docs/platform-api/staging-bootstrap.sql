-- Platform API v1 — staging bootstrap SQL.
--
-- This SQL is NOT applied automatically. Apply it manually on the staging
-- Supabase project only, once the review is complete. It creates the tables,
-- policies, grants and helper function required by the read-only Platform
-- API v1 (see supabase/functions/platform-api).
--
-- Rerunnable: uses CREATE TABLE IF NOT EXISTS and DROP POLICY IF EXISTS.

-- ============================================================================
-- 1) Clients & keys
-- ============================================================================
create table if not exists public.api_clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  environment text not null check (environment in ('test','live')),
  owner_email text,
  scopes text[] not null default '{}',
  quota_per_minute int not null default 60 check (quota_per_minute >= 0),
  quota_per_day int not null default 10000 check (quota_per_day >= 0),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz
);

grant select, insert, update, delete on public.api_clients to authenticated;
grant all on public.api_clients to service_role;

alter table public.api_clients enable row level security;
drop policy if exists "api_clients super admin" on public.api_clients;
create policy "api_clients super admin" on public.api_clients
  for all to authenticated
  using (public.has_role(auth.uid(),'super_admin'))
  with check (public.has_role(auth.uid(),'super_admin'));

create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.api_clients(id) on delete cascade,
  key_prefix text not null,
  key_public_id text not null unique,
  key_hash text not null unique,
  label text,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists api_keys_client_idx on public.api_keys(client_id);

grant select, insert, update, delete on public.api_keys to authenticated;
grant all on public.api_keys to service_role;

alter table public.api_keys enable row level security;
drop policy if exists "api_keys super admin" on public.api_keys;
create policy "api_keys super admin" on public.api_keys
  for all to authenticated
  using (public.has_role(auth.uid(),'super_admin'))
  with check (public.has_role(auth.uid(),'super_admin'));

-- ============================================================================
-- 2) Atomic quota counters
-- ============================================================================
create table if not exists public.api_quota_counters (
  key_id uuid not null references public.api_keys(id) on delete cascade,
  window_kind text not null check (window_kind in ('minute','day')),
  window_start timestamptz not null,
  count int not null default 0,
  primary key (key_id, window_kind, window_start)
);

grant select on public.api_quota_counters to authenticated;
grant all on public.api_quota_counters to service_role;

alter table public.api_quota_counters enable row level security;
drop policy if exists "api_quota super admin read" on public.api_quota_counters;
create policy "api_quota super admin read" on public.api_quota_counters
  for select to authenticated
  using (public.has_role(auth.uid(),'super_admin'));

create or replace function public.api_quota_hit(
  p_key_id uuid, p_per_minute int, p_per_day int
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_minute timestamptz := date_trunc('minute', now());
  v_day    timestamptz := date_trunc('day',    now());
  v_min_count int; v_day_count int;
begin
  insert into public.api_quota_counters(key_id, window_kind, window_start, count)
    values (p_key_id, 'minute', v_minute, 1)
    on conflict (key_id, window_kind, window_start)
    do update set count = public.api_quota_counters.count + 1
    returning count into v_min_count;

  insert into public.api_quota_counters(key_id, window_kind, window_start, count)
    values (p_key_id, 'day', v_day, 1)
    on conflict (key_id, window_kind, window_start)
    do update set count = public.api_quota_counters.count + 1
    returning count into v_day_count;

  if v_min_count > p_per_minute or v_day_count > p_per_day then
    return -1;
  end if;
  return least(p_per_minute - v_min_count, p_per_day - v_day_count);
end $$;

revoke all on function public.api_quota_hit(uuid,int,int) from public;
grant execute on function public.api_quota_hit(uuid,int,int) to service_role;

-- ============================================================================
-- 3) Request logs (redacted)
-- ============================================================================
create table if not exists public.api_request_logs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.api_clients(id) on delete set null,
  key_id uuid references public.api_keys(id) on delete set null,
  method text not null,
  path text not null,
  status int not null,
  scope_required text,
  ip inet,
  user_agent text,
  request_id text,
  latency_ms int,
  error_code text,
  created_at timestamptz not null default now()
);
create index if not exists api_request_logs_client_created_idx
  on public.api_request_logs(client_id, created_at desc);

grant select on public.api_request_logs to authenticated;
grant all on public.api_request_logs to service_role;

alter table public.api_request_logs enable row level security;
drop policy if exists "api_logs super admin read" on public.api_request_logs;
create policy "api_logs super admin read" on public.api_request_logs
  for select to authenticated
  using (public.has_role(auth.uid(),'super_admin'));

-- ============================================================================
-- 4) Outbound webhooks (durable queue)
-- ============================================================================
create table if not exists public.api_webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.api_clients(id) on delete cascade,
  url text not null,
  secret_hash text not null,
  event_types text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.api_webhook_endpoints to authenticated;
grant all on public.api_webhook_endpoints to service_role;

alter table public.api_webhook_endpoints enable row level security;
drop policy if exists "webhook_endpoints super admin" on public.api_webhook_endpoints;
create policy "webhook_endpoints super admin" on public.api_webhook_endpoints
  for all to authenticated
  using (public.has_role(auth.uid(),'super_admin'))
  with check (public.has_role(auth.uid(),'super_admin'));

create table if not exists public.api_webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  endpoint_id uuid not null references public.api_webhook_endpoints(id) on delete cascade,
  event_type text not null,
  event_id text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','delivered','failed','dead')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  last_status_code int,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(endpoint_id, event_id)
);
create index if not exists api_webhook_deliveries_pending_idx
  on public.api_webhook_deliveries(next_attempt_at) where status = 'pending';

grant select on public.api_webhook_deliveries to authenticated;
grant all on public.api_webhook_deliveries to service_role;

alter table public.api_webhook_deliveries enable row level security;
drop policy if exists "webhook_deliveries super admin read" on public.api_webhook_deliveries;
create policy "webhook_deliveries super admin read" on public.api_webhook_deliveries
  for select to authenticated
  using (public.has_role(auth.uid(),'super_admin'));

-- ============================================================================
-- 5) Per-client isolation column on rental_sessions
-- ============================================================================
alter table public.rental_sessions
  add column if not exists api_client_id uuid references public.api_clients(id) on delete set null;

create index if not exists rental_sessions_api_client_idx
  on public.rental_sessions(api_client_id);
