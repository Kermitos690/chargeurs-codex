\set ON_ERROR_STOP on

-- Isolated PostgreSQL contract test for Platform API v1.
-- This runs only against the disposable CI database.

create extension if not exists pgcrypto;

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

\ir ../migrations/20260719133000_platform_api_readonly_v1.sql

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
end
$$;

-- Valid read-only client and key.
insert into public.api_clients (
  id, name, environment, scopes, quota_per_minute, quota_per_day
) values (
  '00000000-0000-0000-0000-000000000101',
  'CI read-only client',
  'test',
  array['health:read', 'stations:read'],
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
