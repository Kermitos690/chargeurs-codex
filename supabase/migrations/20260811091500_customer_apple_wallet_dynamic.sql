-- Apple Wallet dynamic-update registrations for the existing Chargeurs+ pass model.
-- This migration deliberately does NOT create a second pass source of truth and
-- does NOT introduce synthetic membership, rental, credit or loyalty data.

create table if not exists public.customer_wallet_device_registrations (
  id uuid primary key default gen_random_uuid(),
  wallet_pass_id uuid not null references public.customer_wallet_passes(id) on delete cascade,
  device_library_identifier_hash text not null,
  push_token text not null,
  registered_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unregistered_at timestamptz,
  constraint customer_wallet_device_registrations_device_hash_check
    check (device_library_identifier_hash ~ '^[0-9a-f]{64}$'),
  constraint customer_wallet_device_registrations_push_token_check
    check (char_length(push_token) between 1 and 4096),
  unique (wallet_pass_id, device_library_identifier_hash)
);

create index if not exists customer_wallet_device_registrations_device_active_idx
  on public.customer_wallet_device_registrations(device_library_identifier_hash, wallet_pass_id)
  where unregistered_at is null;

create index if not exists customer_wallet_device_registrations_pass_active_idx
  on public.customer_wallet_device_registrations(wallet_pass_id)
  where unregistered_at is null;

alter table public.customer_wallet_device_registrations enable row level security;

-- Apple devices never access this table through PostgREST. The public Apple
-- web-service Edge Function uses the service role after validating Apple's
-- per-pass authentication token / device identifier protocol.
revoke all on table public.customer_wallet_device_registrations from anon, authenticated;
grant all on table public.customer_wallet_device_registrations to service_role;
