-- A narrowly scoped, service-role-only permit for one manually authorised
-- staging ejection. It is consumed before a supplier mutation, so a timeout
-- cannot automatically trigger a second physical release.
create table if not exists public.one_time_rental_ejection_permits (
  id uuid primary key default gen_random_uuid(),
  rental_session_id uuid not null unique references public.rental_sessions(id) on delete cascade,
  station_id text not null,
  slot_num integer not null check (slot_num >= 1),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  created_by text not null default 'operator',
  constraint one_time_rental_ejection_permits_expiry_check check (expires_at > created_at)
);

alter table public.one_time_rental_ejection_permits enable row level security;
revoke all on table public.one_time_rental_ejection_permits from anon, authenticated;

comment on table public.one_time_rental_ejection_permits is
  'Service-role-only, time-limited permits for a single human-authorised staging battery ejection.';
