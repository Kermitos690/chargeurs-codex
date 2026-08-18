-- Advertising QR scan telemetry.
-- Public clients receive no direct table privileges; writes are performed only
-- by the server-side ads-qr-redirect Edge Function after validating campaign,
-- media and station targeting.

create table if not exists public.advertising_qr_scans (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.advertising_campaigns(id) on delete cascade,
  asset_id uuid not null references public.advertising_assets(id) on delete cascade,
  station_id text not null,
  scanned_at timestamptz not null default now(),
  destination_host text not null,
  source text not null default 'kiosk_qr'
);

alter table public.advertising_qr_scans enable row level security;

revoke all on table public.advertising_qr_scans from anon, authenticated;

create index if not exists advertising_qr_scans_campaign_scanned_idx
  on public.advertising_qr_scans(campaign_id, scanned_at desc);

create index if not exists advertising_qr_scans_station_scanned_idx
  on public.advertising_qr_scans(station_id, scanned_at desc);

create index if not exists advertising_qr_scans_asset_scanned_idx
  on public.advertising_qr_scans(asset_id, scanned_at desc);
