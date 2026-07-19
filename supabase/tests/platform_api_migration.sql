\set ON_ERROR_STOP on

-- Isolated PostgreSQL contract test for Platform API v1.
-- This runs only against the disposable CI database.

-- Supabase installs pgcrypto in `extensions`; reproduce that layout so schema
-- qualification regressions are caught by this disposable PostgreSQL contract.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists auth;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
end
$$;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid()
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create or replace function public.has_role(p_user_id uuid, p_role text)
returns boolean
language sql
stable
as $$
  select p_role = 'super_admin'
$$;

create table if not exists public.rental_sessions (
  id uuid primary key default gen_random_uuid()
);

create table if not exists public.system_incidents (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  severity text not null default 'warning',
  message text,
  data jsonb,
  resolved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- First exercise a completely fresh installation. PostgreSQL DDL is
-- transactional, so rolling this block back leaves the same disposable
-- database ready for the legacy-bootstrap reconciliation contract below.
begin;
\ir ../migrations/20260719133000_platform_api_readonly_v1.sql
\ir ../migrations/20260719143000_platform_api_legacy_reconciliation.sql
\ir ../migrations/20260719143000_platform_api_legacy_reconciliation.sql

insert into public.api_clients (
  name, environment, scopes, quota_per_minute, quota_per_day
) values (
  'Fresh incidents client',
  'test',
  array['incidents:read'],
  60,
  10000
);

do $$
begin
  if to_regclass('public.api_clients') is null
    or to_regclass('public.api_request_logs') is null then
    raise exception 'fresh Platform API tables missing';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'api_request_logs'
      and column_name = 'ip'
  ) then
    raise exception 'fresh installation unexpectedly contains a raw IP column';
  end if;
  if to_regclass('public.system_incidents_public_listing_idx') is null
    or to_regclass('public.system_incidents_unresolved_listing_idx') is null then
    raise exception 'fresh incident indexes missing';
  end if;
end
$$;

rollback;

-- Reproduce the relevant shape and overly broad policies of the retired
-- docs/platform-api/staging-bootstrap.sql before applying versioned migrations.
create table public.api_clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  environment text not null check (environment in ('test', 'live')),
  owner_email text,
  scopes text[] not null default '{}',
  quota_per_minute integer not null default 60 check (quota_per_minute >= 0),
  quota_per_day integer not null default 10000 check (quota_per_day >= 0),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz
);
alter table public.api_clients enable row level security;
grant select, insert, update, delete on public.api_clients to authenticated;
create policy "api_clients super admin" on public.api_clients
  for all to authenticated
  using (public.has_role(auth.uid(), 'super_admin'))
  with check (public.has_role(auth.uid(), 'super_admin'));

create table public.api_keys (
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
alter table public.api_keys enable row level security;
grant select, insert, update, delete on public.api_keys to authenticated;
create policy "api_keys super admin" on public.api_keys
  for all to authenticated
  using (public.has_role(auth.uid(), 'super_admin'))
  with check (public.has_role(auth.uid(), 'super_admin'));

create table public.api_request_logs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.api_clients(id) on delete set null,
  key_id uuid references public.api_keys(id) on delete set null,
  method text not null,
  path text not null,
  status integer not null,
  scope_required text,
  ip inet,
  user_agent text,
  request_id text,
  latency_ms integer,
  error_code text,
  created_at timestamptz not null default now()
);
alter table public.api_request_logs enable row level security;
grant select on public.api_request_logs to authenticated;

create table public.api_webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.api_clients(id) on delete cascade,
  url text not null,
  secret_hash text not null,
  event_types text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.api_webhook_endpoints enable row level security;
grant select, insert, update, delete on public.api_webhook_endpoints to authenticated;
create policy "webhook_endpoints super admin" on public.api_webhook_endpoints
  for all to authenticated
  using (public.has_role(auth.uid(), 'super_admin'))
  with check (public.has_role(auth.uid(), 'super_admin'));

create table public.api_webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  endpoint_id uuid not null references public.api_webhook_endpoints(id) on delete cascade,
  event_type text not null,
  event_id text not null,
  payload jsonb not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.api_webhook_deliveries enable row level security;
-- Include direct DML drift so the optional-table reconciliation branch has an
-- observable security assertion, not merely a table-existence smoke test.
grant select, insert, update, delete on public.api_webhook_deliveries to authenticated;

insert into public.api_clients (
  id, name, environment, scopes, quota_per_minute, quota_per_day
) values (
  '00000000-0000-0000-0000-000000000100',
  'Unsafe legacy client',
  'test',
  array['payments:write'],
  60,
  10000
);

insert into public.api_request_logs (id, method, path, status, ip)
values (
  '00000000-0000-0000-0000-000000000300',
  'GET',
  '/v1/health',
  200,
  '192.0.2.1'
);

\ir ../migrations/20260719133000_platform_api_readonly_v1.sql
\ir ../migrations/20260719143000_platform_api_legacy_reconciliation.sql
-- Prove that reconciliation is safe to replay.
\ir ../migrations/20260719143000_platform_api_legacy_reconciliation.sql

-- Schema presence.
do $$
begin
  if to_regclass('public.api_clients') is null then
    raise exception 'api_clients missing';
  end if;
  if to_regclass('public.api_keys') is null then
    raise exception 'api_keys missing';
  end if;
  if to_regclass('public.api_quota_counters') is null then
    raise exception 'api_quota_counters missing';
  end if;
  if to_regclass('public.api_request_logs') is null then
    raise exception 'api_request_logs missing';
  end if;
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'rental_sessions'
      and column_name = 'api_client_id'
  ) then
    raise exception 'rental_sessions.api_client_id missing';
  end if;
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'api_keys'
      and column_name = 'created_by'
  ) then
    raise exception 'api_keys.created_by missing';
  end if;
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'api_request_logs'
      and column_name = 'metadata'
  ) then
    raise exception 'api_request_logs.metadata missing';
  end if;
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'api_request_logs'
      and column_name = 'ip'
  ) then
    raise exception 'legacy raw api_request_logs.ip column still exists';
  end if;
end
$$;

-- Legacy raw IPs are irreversibly transformed, and unsafe clients are revoked.
do $$
declare
  migrated_hash text;
  legacy_active boolean;
  legacy_scopes text[];
  legacy_revoked_at timestamptz;
begin
  select ip_hash into migrated_hash
  from public.api_request_logs
  where id = '00000000-0000-0000-0000-000000000300';
  if migrated_hash is null or migrated_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'legacy IP was not safely transformed';
  end if;
  if migrated_hash = '192.0.2.1' then
    raise exception 'legacy raw IP survived reconciliation';
  end if;

  select active, scopes, revoked_at
  into legacy_active, legacy_scopes, legacy_revoked_at
  from public.api_clients
  where id = '00000000-0000-0000-0000-000000000100';
  if legacy_active or legacy_revoked_at is null then
    raise exception 'unsafe legacy client was not revoked';
  end if;
  if legacy_scopes <> array['health:read']::text[] then
    raise exception 'unsafe legacy scopes were not removed: %', legacy_scopes;
  end if;
end
$$;

-- The broad write policies and direct authenticated DML privileges are gone.
do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and policyname in (
        'api_clients super admin',
        'api_keys super admin',
        'webhook_endpoints super admin'
      )
  ) then
    raise exception 'legacy write policy survived reconciliation';
  end if;
  if has_table_privilege('authenticated', 'public.api_clients', 'INSERT')
    or has_table_privilege('authenticated', 'public.api_keys', 'UPDATE')
    or has_table_privilege('authenticated', 'public.api_webhook_endpoints', 'DELETE')
    or has_table_privilege('authenticated', 'public.api_webhook_deliveries', 'UPDATE') then
    raise exception 'authenticated still has direct Platform API write privileges';
  end if;
end
$$;

-- Valid read-only client and key.
insert into public.api_clients (
  id, name, environment, scopes, quota_per_minute, quota_per_day
) values (
  '00000000-0000-0000-0000-000000000101',
  'CI read-only client',
  'test',
  array['health:read', 'stations:read', 'incidents:read'],
  1,
  2
);

insert into public.api_keys (
  id, client_id, key_prefix, key_public_id, key_hash, label
) values (
  '00000000-0000-0000-0000-000000000201',
  '00000000-0000-0000-0000-000000000101',
  'chg_test_',
  'abcdefghijkl',
  repeat('a', 64),
  'CI key'
);

-- Quota accounting is atomic and rejects the second request in the minute.
do $$
declare
  first_remaining integer;
  second_remaining integer;
begin
  select public.api_quota_hit(
    '00000000-0000-0000-0000-000000000201', 1, 2
  ) into first_remaining;
  select public.api_quota_hit(
    '00000000-0000-0000-0000-000000000201', 1, 2
  ) into second_remaining;

  if first_remaining <> 0 then
    raise exception 'unexpected first quota result: %', first_remaining;
  end if;
  if second_remaining <> -1 then
    raise exception 'quota did not reject second request: %', second_remaining;
  end if;
end
$$;

-- Write scopes are forbidden by the database constraint.
do $$
begin
  begin
    insert into public.api_clients (
      name, environment, scopes
    ) values (
      'Invalid write client', 'test', array['payments:write']
    );
    raise exception 'write scope was accepted';
  exception
    when check_violation then null;
  end;
end
$$;

-- Raw IP addresses cannot be stored in ip_hash.
do $$
begin
  begin
    insert into public.api_request_logs (
      method, path, status, ip_hash
    ) values (
      'GET', '/v1/health', 200, '192.0.2.1'
    );
    raise exception 'raw IP was accepted';
  exception
    when check_violation then null;
  end;
end
$$;

-- RLS must be enabled on every API administration table.
do $$
declare
  disabled_count integer;
begin
  select count(*) into disabled_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('api_clients', 'api_keys', 'api_quota_counters', 'api_request_logs')
    and not c.relrowsecurity;

  if disabled_count <> 0 then
    raise exception 'RLS disabled on % table(s)', disabled_count;
  end if;
end
$$;

select 'Platform API migration contract passed' as result;
