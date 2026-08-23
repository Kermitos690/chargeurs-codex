-- Pass Studio is a presentation/distribution provider only.
-- Chargeurs.ch membership, pricing and ChargePoints remain canonical in our DB.

alter table if exists public.customer_wallet_passes
  add column if not exists provider text not null default 'chargeurs_native',
  add column if not exists provider_pass_id text,
  add column if not exists provider_instance_id text,
  add column if not exists provider_holder_id text,
  add column if not exists provider_barcode_content text,
  add column if not exists provider_add_to_wallet_url text,
  add column if not exists provider_last_error_code text;

create index if not exists customer_wallet_passes_provider_instance_idx
  on public.customer_wallet_passes(provider, provider_instance_id)
  where provider_instance_id is not null;

comment on column public.customer_wallet_passes.provider_add_to_wallet_url is
  'Provider-hosted Add to Wallet URL. Never contains the Pass Studio API key.';
