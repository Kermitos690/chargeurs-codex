-- Chargeurs.ch local gateway shadow observations.
-- Stores read-only observations produced by the Android kiosk while ChargeNow
-- remains the active hardware gateway. This creates the comparison baseline
-- required before any endpoint or local protocol is replaced.

create table if not exists public.local_gateway_observations (
  id uuid primary key default gen_random_uuid(),
  station_id text not null references public.stations(station_id) on delete cascade,
  kiosk_device_id uuid not null references public.kiosk_devices(id) on delete cascade,
  device_public_id text not null check (char_length(device_public_id) between 8 and 160),
  app_version text not null check (char_length(app_version) between 1 and 80),
  sequence bigint not null check (sequence >= 0),
  mode text not null default 'shadow' check (mode in ('shadow', 'native_read_only', 'native_control')),
  report_sha256 text not null check (report_sha256 ~ '^[0-9a-f]{64}$'),
  report jsonb not null,
  provider_snapshot jsonb,
  provider_last_sync_at timestamptz,
  received_at timestamptz not null default now(),
  unique (kiosk_device_id, sequence)
);

create index if not exists local_gateway_observations_station_received_idx
  on public.local_gateway_observations (station_id, received_at desc);

create index if not exists local_gateway_observations_device_received_idx
  on public.local_gateway_observations (kiosk_device_id, received_at desc);

create index if not exists local_gateway_observations_report_gin_idx
  on public.local_gateway_observations using gin (report jsonb_path_ops);

alter table public.local_gateway_observations enable row level security;

revoke all on public.local_gateway_observations from anon, authenticated;

comment on table public.local_gateway_observations is
  'Read-only Android hardware and runtime observations used to compare the local borne state with the ChargeNow provider state during progressive extraction.';
