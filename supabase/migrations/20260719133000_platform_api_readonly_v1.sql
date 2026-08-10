-- Chargeurs.ch Platform API v1 (read-only) schema.
--
-- Safety boundary:
-- - API clients and keys are administered only through the super-admin Edge Function.
-- - Raw API keys are never persisted; only SHA-256 digests are stored.
-- - Public API scopes are limited to read-only capabilities.
-- - No payment, rental mutation, ChargeNow command or hardware action is created here.

create table if not exists public.api_clients (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  environment text not null check (environment in ('test', 'live')),
  owner_email text,
  scopes text[] not null,
  quota_per_minute integer not null default 60 check (quota_per_minute between 1 and 10000),
  quota_per_day integer not null default 10000 check (quota_per_day between 1 and 1000000),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint api_clients_read_scopes_only check (
    cardinality(scopes) > 0
    and scopes <@ array[
      'health:read',
      'stations:read',
      'inventory:read',
      'pricing:read',
      'rentals:read'
    ]::text[]
  )
);

create index if not exists api_clients_environment_active_idx
  on public.api_clients(environment, active);

create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.api_clients(id) on delete cascade,
  key_prefix text not null check (key_prefix in ('chg_test_', 'chg_live_')),
  key_public_id text not null unique check (char_length(key_public_id) = 12),
  key_hash text not null unique check (key_hash ~ '^[a-f0-9]{64}$'),
  label text,
  created_by uuid references auth.users(id) on delete set null,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists api_keys_client_created_idx
  on public.api_keys(client_id, created_at desc);
create index if not exists api_keys_active_hash_idx
  on public.api_keys(key_hash) where revoked_at is null;

create table if not exists public.api_quota_counters (
  key_id uuid not null references public.api_keys(id) on delete cascade,
  window_kind text not null check (window_kind in ('minute', 'day')),
  window_start timestamptz not null,
  count integer not null default 0 check (count >= 0),
  primary key (key_id, window_kind, window_start)
);

create table if not exists public.api_request_logs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.api_clients(id) on delete set null,
  key_id uuid references public.api_keys(id) on delete set null,
  method text not null,
  path text not null,
  status integer not null,
  scope_required text,
  ip_hash text check (ip_hash is null or ip_hash ~ '^[a-f0-9]{64}$'),
  user_agent text,
  request_id text,
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  error_code text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists api_request_logs_client_created_idx
  on public.api_request_logs(client_id, created_at desc);
create index if not exists api_request_logs_request_id_idx
  on public.api_request_logs(request_id);

-- Public rental reads are isolated by the API client that owns the rental.
alter table public.rental_sessions
  add column if not exists api_client_id uuid references public.api_clients(id) on delete set null;
create index if not exists rental_sessions_api_client_idx
  on public.rental_sessions(api_client_id);

-- Atomic minute/day quota consumption. Service role only.
create or replace function public.api_quota_hit(
  p_key_id uuid,
  p_per_minute integer,
  p_per_day integer
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_minute timestamptz := date_trunc('minute', now());
  v_day timestamptz := date_trunc('day', now());
  v_minute_count integer;
  v_day_count integer;
begin
  if p_per_minute < 1 or p_per_day < 1 then
    return -1;
  end if;

  insert into public.api_quota_counters(key_id, window_kind, window_start, count)
  values (p_key_id, 'minute', v_minute, 1)
  on conflict (key_id, window_kind, window_start)
  do update set count = public.api_quota_counters.count + 1
  returning count into v_minute_count;

  insert into public.api_quota_counters(key_id, window_kind, window_start, count)
  values (p_key_id, 'day', v_day, 1)
  on conflict (key_id, window_kind, window_start)
  do update set count = public.api_quota_counters.count + 1
  returning count into v_day_count;

  if v_minute_count > p_per_minute or v_day_count > p_per_day then
    return -1;
  end if;

  return least(p_per_minute - v_minute_count, p_per_day - v_day_count);
end;
$$;

revoke all on function public.api_quota_hit(uuid, integer, integer) from public;
grant execute on function public.api_quota_hit(uuid, integer, integer) to service_role;

-- RLS: authenticated users can only read these tables when they are super-admins.
-- All writes are performed by service-role Edge Functions after explicit role checks.
alter table public.api_clients enable row level security;
alter table public.api_keys enable row level security;
alter table public.api_quota_counters enable row level security;
alter table public.api_request_logs enable row level security;

drop policy if exists "api_clients super admin read" on public.api_clients;
create policy "api_clients super admin read" on public.api_clients
  for select to authenticated
  using (public.has_role(auth.uid(), 'super_admin'));

drop policy if exists "api_keys super admin read" on public.api_keys;
create policy "api_keys super admin read" on public.api_keys
  for select to authenticated
  using (public.has_role(auth.uid(), 'super_admin'));

drop policy if exists "api_quota super admin read" on public.api_quota_counters;
create policy "api_quota super admin read" on public.api_quota_counters
  for select to authenticated
  using (public.has_role(auth.uid(), 'super_admin'));

drop policy if exists "api_logs super admin read" on public.api_request_logs;
create policy "api_logs super admin read" on public.api_request_logs
  for select to authenticated
  using (public.has_role(auth.uid(), 'super_admin'));

revoke all on public.api_clients from anon;
revoke all on public.api_keys from anon;
revoke all on public.api_quota_counters from anon;
revoke all on public.api_request_logs from anon;

revoke insert, update, delete on public.api_clients from authenticated;
revoke insert, update, delete on public.api_keys from authenticated;
revoke insert, update, delete on public.api_quota_counters from authenticated;
revoke insert, update, delete on public.api_request_logs from authenticated;

grant select on public.api_clients to authenticated;
grant select on public.api_keys to authenticated;
grant select on public.api_quota_counters to authenticated;
grant select on public.api_request_logs to authenticated;

grant all on public.api_clients to service_role;
grant all on public.api_keys to service_role;
grant all on public.api_quota_counters to service_role;
grant all on public.api_request_logs to service_role;

comment on table public.api_clients is 'Read-only Platform API clients managed by super-admin Edge Functions.';
comment on table public.api_keys is 'Hashed Platform API keys. Raw secrets are never stored.';
-- A database initialized with the retired docs/platform-api/staging-bootstrap.sql
-- still has api_request_logs.ip instead of ip_hash. Keep this migration
-- applicable there; the following reconciliation migration adds the safe
-- column, irreversibly transforms legacy values and drops the raw column.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'api_request_logs'
      and column_name = 'ip_hash'
  ) then
    comment on column public.api_request_logs.ip_hash is
      'One-way salted SHA-256 hash, never a raw client IP address.';
  end if;
end
$$;
