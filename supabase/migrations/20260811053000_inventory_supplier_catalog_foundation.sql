-- AGENT 7 - Inventory & Supply Chain
-- Supplier catalog foundation + Bajie quotation ingestion.
--
-- Safety:
-- - additive only: no existing station, slot, battery, rental, payment or hardware-control table is altered;
-- - all catalog facts ingested from the user-provided Bajie quotation are SUPPLIER_DECLARED;
-- - supplier catalog presence does not mean Chargeurs.ch owns, deploys or has validated the item;
-- - supplier prices are factory/catalog hardware prices only and are not landed costs or customer prices.

create table if not exists public.inventory_suppliers (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  trade_name text,
  manufacturer_name text,
  country_code text,
  website text,
  address jsonb not null default '{}'::jsonb,
  status text not null default 'active'
    check (status in ('active','inactive','blocked')),
  verification_state text not null default 'unknown'
    check (verification_state in ('verified','supplier_declared','observed','inferred','unknown')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists inventory_suppliers_legal_name_uidx
  on public.inventory_suppliers (lower(legal_name));

create table if not exists public.inventory_source_documents (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references public.inventory_suppliers(id) on delete restrict,
  source_reference text not null unique,
  source_type text not null,
  title text not null,
  original_filename text,
  document_date date,
  page_count integer check (page_count is null or page_count > 0),
  verification_state text not null default 'unknown'
    check (verification_state in ('verified','supplier_declared','observed','inferred','unknown')),
  notes text,
  ingested_at timestamptz not null default now()
);

create table if not exists public.inventory_supplier_contacts (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.inventory_suppliers(id) on delete restrict,
  contact_role text not null,
  name text,
  job_title text,
  email text,
  phone text,
  messaging_handle text,
  language text,
  verification_state text not null default 'unknown'
    check (verification_state in ('verified','supplier_declared','observed','inferred','unknown')),
  source_document_id uuid references public.inventory_source_documents(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_supplier_contact_targets (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.inventory_suppliers(id) on delete restrict,
  contact_role text not null,
  status text not null default 'unknown'
    check (status in ('unknown','requested','identified','verified','not_applicable')),
  source_document_id uuid references public.inventory_source_documents(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (supplier_id, contact_role)
);

create table if not exists public.inventory_products (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  product_type text not null,
  status text not null default 'candidate'
    check (status in ('candidate','active','retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.inventory_products(id) on delete restrict,
  internal_code text not null unique,
  normalized_name text not null,
  attributes jsonb not null default '{}'::jsonb,
  status text not null default 'candidate'
    check (status in ('candidate','active','retired')),
  verification_state text not null default 'unknown'
    check (verification_state in ('verified','supplier_declared','observed','inferred','unknown')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists inventory_product_variants_product_idx
  on public.inventory_product_variants(product_id);

create table if not exists public.inventory_supplier_products (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.inventory_suppliers(id) on delete restrict,
  product_variant_id uuid not null references public.inventory_product_variants(id) on delete restrict,
  source_document_id uuid references public.inventory_source_documents(id) on delete set null,
  supplier_sku text,
  supplier_variant_key text not null,
  supplier_product_name text not null,
  catalog_section text,
  source_page integer check (source_page is null or source_page > 0),
  procurement_mode text not null default 'unknown'
    check (procurement_mode in ('supplier_quote','local_purchase','contact_supplier','unknown')),
  status text not null default 'quoted'
    check (status in ('quoted','available','discontinued','unknown')),
  verification_state text not null default 'supplier_declared'
    check (verification_state in ('verified','supplier_declared','observed','inferred','unknown')),
  supplier_specifications jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (supplier_id, supplier_variant_key)
);

create index if not exists inventory_supplier_products_supplier_sku_idx
  on public.inventory_supplier_products(supplier_id, supplier_sku)
  where supplier_sku is not null;

create index if not exists inventory_supplier_products_variant_idx
  on public.inventory_supplier_products(product_variant_id);

create table if not exists public.inventory_supplier_offers (
  id uuid primary key default gen_random_uuid(),
  supplier_product_id uuid not null references public.inventory_supplier_products(id) on delete restrict,
  offer_key text not null,
  quantity_label text,
  quantity_min integer check (quantity_min is null or quantity_min >= 0),
  quantity_max integer check (quantity_max is null or quantity_max >= 0),
  configuration_label text,
  unit_cost numeric(14,2) check (unit_cost is null or unit_cost >= 0),
  currency text not null default 'USD',
  verification_state text not null default 'supplier_declared'
    check (verification_state in ('verified','supplier_declared','observed','inferred','unknown')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (supplier_product_id, offer_key),
  check (quantity_max is null or quantity_min is null or quantity_max >= quantity_min)
);

create index if not exists inventory_supplier_offers_product_idx
  on public.inventory_supplier_offers(supplier_product_id);

alter table public.inventory_suppliers enable row level security;
alter table public.inventory_source_documents enable row level security;
alter table public.inventory_supplier_contacts enable row level security;
alter table public.inventory_supplier_contact_targets enable row level security;
alter table public.inventory_products enable row level security;
alter table public.inventory_product_variants enable row level security;
alter table public.inventory_supplier_products enable row level security;
alter table public.inventory_supplier_offers enable row level security;

revoke all on public.inventory_suppliers from public, anon, authenticated;
revoke all on public.inventory_source_documents from public, anon, authenticated;
revoke all on public.inventory_supplier_contacts from public, anon, authenticated;
revoke all on public.inventory_supplier_contact_targets from public, anon, authenticated;
revoke all on public.inventory_products from public, anon, authenticated;
revoke all on public.inventory_product_variants from public, anon, authenticated;
revoke all on public.inventory_supplier_products from public, anon, authenticated;
revoke all on public.inventory_supplier_offers from public, anon, authenticated;

grant select, insert, update, delete on public.inventory_suppliers to service_role;
grant select, insert, update, delete on public.inventory_source_documents to service_role;
grant select, insert, update, delete on public.inventory_supplier_contacts to service_role;
grant select, insert, update, delete on public.inventory_supplier_contact_targets to service_role;
grant select, insert, update, delete on public.inventory_products to service_role;
grant select, insert, update, delete on public.inventory_product_variants to service_role;
grant select, insert, update, delete on public.inventory_supplier_products to service_role;
grant select, insert, update, delete on public.inventory_supplier_offers to service_role;

comment on table public.inventory_suppliers is
  'AGENT 7 supplier master. Supplier presence does not imply an approved Chargeurs.ch product.';
comment on table public.inventory_supplier_products is
  'Supplier catalog mapping. Facts remain supplier-declared until separately verified or observed.';
comment on table public.inventory_supplier_offers is
  'Supplier quote/configuration offers only. Never use as landed cost, customer price or financial source of truth.';
comment on table public.inventory_supplier_contact_targets is
  'Required supplier contact roles that may remain UNKNOWN until real contact details are obtained.';
