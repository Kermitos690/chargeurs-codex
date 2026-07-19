-- Reconcile the canonical read-only Platform API with databases that executed
-- the retired docs/platform-api/staging-bootstrap.sql before migrations were
-- versioned. This migration is deliberately idempotent.

create extension if not exists pgcrypto;

alter table public.api_keys
  add column if not exists created_by uuid references auth.users(id) on delete set null;

alter table public.api_request_logs
  add column if not exists ip_hash text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

update public.api_request_logs
set metadata = '{}'::jsonb
where metadata is null;

alter table public.api_request_logs
  alter column metadata set default '{}'::jsonb,
  alter column metadata set not null;

-- A migration-only random value makes every legacy IP irreversible and
-- unlinkable to future salted application hashes. The raw inet column is then
-- removed, so no clear address survives this migration.
do $$
declare
  pgcrypto_schema text;
begin
  select namespace.nspname
  into pgcrypto_schema
  from pg_extension as extension
  join pg_namespace as namespace on namespace.oid = extension.extnamespace
  where extension.extname = 'pgcrypto';

  if pgcrypto_schema is null then
    raise exception 'pgcrypto extension is required for legacy IP reconciliation';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'api_request_logs'
      and column_name = 'ip'
  ) then
    execute format($sql$
      update public.api_request_logs
      set ip_hash = encode(
        %I.digest(encode(%I.gen_random_bytes(32), 'hex') || ':' || ip::text, 'sha256'),
        'hex'
      )
      where ip is not null and ip_hash is null
    $sql$, pgcrypto_schema, pgcrypto_schema);
    execute 'alter table public.api_request_logs drop column ip';
  end if;
end
$$;

-- Never preserve malformed or raw values in the replacement column.
update public.api_request_logs
set ip_hash = null
where ip_hash is not null
  and ip_hash !~ '^[a-f0-9]{64}$';

alter table public.api_request_logs
  drop constraint if exists api_request_logs_ip_hash_check,
  drop constraint if exists api_request_logs_ip_hash_sha256_check;
alter table public.api_request_logs
  add constraint api_request_logs_ip_hash_sha256_check
  check (ip_hash is null or ip_hash ~ '^[a-f0-9]{64}$');

comment on column public.api_request_logs.ip_hash is
  'One-way SHA-256 value. New entries are salted by the Platform API; legacy raw IPs were irreversibly transformed.';

-- Retain only the frozen read-only scopes. A legacy client left without a
-- valid scope is revoked before receiving a harmless placeholder scope so the
-- non-empty database invariant can be restored without deleting audit history.
update public.api_clients as client
set scopes = coalesce((
  select array_agg(scope order by scope)
  from (
    select distinct requested_scope.value as scope
    from unnest(coalesce(client.scopes, '{}'::text[])) as requested_scope(value)
    where requested_scope.value = any(array[
      'health:read',
      'stations:read',
      'inventory:read',
      'pricing:read',
      'rentals:read',
      'incidents:read'
    ]::text[])
  ) as allowed_scopes
), '{}'::text[]);

update public.api_clients
set active = false,
    revoked_at = coalesce(revoked_at, now())
where cardinality(scopes) = 0;

update public.api_clients
set scopes = array['health:read']::text[]
where cardinality(scopes) = 0;

alter table public.api_clients
  drop constraint if exists api_clients_read_scopes_only;
alter table public.api_clients
  add constraint api_clients_read_scopes_only check (
    cardinality(scopes) > 0
    and scopes <@ array[
      'health:read',
      'stations:read',
      'inventory:read',
      'pricing:read',
      'rentals:read',
      'incidents:read'
    ]::text[]
  );

-- Support the public incident list's stable sort and its common unresolved
-- view without indexing private message/data fields.
create index if not exists system_incidents_public_listing_idx
  on public.system_incidents(created_at desc, id desc);
create index if not exists system_incidents_unresolved_listing_idx
  on public.system_incidents(created_at desc, id desc)
  where resolved = false;

-- The legacy bootstrap allowed direct authenticated writes through FOR ALL
-- policies. Administration now goes exclusively through api-key-admin after a
-- server-side super_admin check.
drop policy if exists "api_clients super admin" on public.api_clients;
drop policy if exists "api_keys super admin" on public.api_keys;

revoke insert, update, delete on public.api_clients from authenticated;
revoke insert, update, delete on public.api_keys from authenticated;
revoke insert, update, delete on public.api_quota_counters from authenticated;
revoke insert, update, delete on public.api_request_logs from authenticated;

-- Secure optional webhook tables left behind by the retired bootstrap without
-- requiring them to exist on a fresh installation.
do $$
begin
  if to_regclass('public.api_webhook_endpoints') is not null then
    execute 'drop policy if exists "webhook_endpoints super admin" on public.api_webhook_endpoints';
    execute 'revoke insert, update, delete on public.api_webhook_endpoints from authenticated';
  end if;
  if to_regclass('public.api_webhook_deliveries') is not null then
    execute 'revoke insert, update, delete on public.api_webhook_deliveries from authenticated';
  end if;
end
$$;
