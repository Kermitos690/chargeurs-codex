-- One-time, server-only permits for manual ChargeNow C2 maintenance ejections.
-- The browser never reads or writes this table directly. A super-admin asks the
-- admin-maintenance-action Edge Function to prepare a precise station+slot
-- target, then the same Edge Function atomically consumes the permit before the
-- supplier call. This keeps customer rental mutations disabled while allowing
-- controlled workshop diagnostics.

create table if not exists public.maintenance_ejection_permits (
  id uuid primary key default gen_random_uuid(),
  station_id text not null references public.stations(station_id) on delete restrict,
  slot_num integer not null check (slot_num >= 1 and slot_num <= 128),
  expected_battery_id text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_by uuid references auth.users(id) on delete set null,
  cancelled_at timestamptz,
  constraint maintenance_ejection_permits_expiry_check check (expires_at > created_at),
  constraint maintenance_ejection_permits_terminal_check check (not (consumed_at is not null and cancelled_at is not null))
);

create index if not exists maintenance_ejection_permits_target_idx
  on public.maintenance_ejection_permits (station_id, slot_num, expires_at desc);

create index if not exists maintenance_ejection_permits_open_idx
  on public.maintenance_ejection_permits (expires_at)
  where consumed_at is null and cancelled_at is null;

alter table public.maintenance_ejection_permits enable row level security;

revoke all on table public.maintenance_ejection_permits from anon, authenticated;

grant all on table public.maintenance_ejection_permits to service_role;

comment on table public.maintenance_ejection_permits is
  'Short-lived service-role-only permits for one exact super-admin maintenance C2 ejection.';
