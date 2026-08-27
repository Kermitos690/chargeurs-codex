create table if not exists public.maintenance_ejection_permits (
  id uuid primary key default gen_random_uuid(),
  station_id text not null,
  slot_num integer not null check (slot_num between 1 and 128),
  expected_battery_id text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_by uuid references auth.users(id) on delete restrict,
  cancelled_at timestamptz,
  provider_result jsonb,
  constraint maintenance_ejection_permits_expiry_check check (expires_at > created_at)
);

alter table public.maintenance_ejection_permits enable row level security;

create index if not exists maintenance_ejection_permits_active_idx
  on public.maintenance_ejection_permits (station_id, slot_num, expires_at)
  where consumed_at is null and cancelled_at is null;

comment on table public.maintenance_ejection_permits is
  'Service-role-only, short-lived, single-use permits for super-admin ChargeNow C2 maintenance ejections. No client rental or payment path may consume these permits.';
