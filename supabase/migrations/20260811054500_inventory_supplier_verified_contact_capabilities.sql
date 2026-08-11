-- AGENT 7 - Inventory & Supply Chain
-- Current Bajie official-website contact details + supplier-declared solution capabilities.
--
-- Contact channel provenance is VERIFIED as currently published on the official
-- supplier website. Marketing capability / venue-fit claims remain
-- SUPPLIER_DECLARED: source authenticity does not independently validate the claim.

create table if not exists public.inventory_supplier_capabilities (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.inventory_suppliers(id) on delete restrict,
  capability_code text not null,
  capability_name text not null,
  value jsonb not null default '{}'::jsonb,
  verification_state text not null default 'supplier_declared'
    check (verification_state in ('verified','supplier_declared','observed','inferred','unknown')),
  source_document_id uuid references public.inventory_source_documents(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (supplier_id, capability_code)
);

create table if not exists public.inventory_supplier_target_venues (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.inventory_suppliers(id) on delete restrict,
  venue_type text not null,
  supplier_claim text,
  verification_state text not null default 'supplier_declared'
    check (verification_state in ('verified','supplier_declared','observed','inferred','unknown')),
  source_document_id uuid references public.inventory_source_documents(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (supplier_id, venue_type)
);

create index if not exists inventory_supplier_capabilities_supplier_idx
  on public.inventory_supplier_capabilities(supplier_id);
create index if not exists inventory_supplier_capabilities_source_idx
  on public.inventory_supplier_capabilities(source_document_id)
  where source_document_id is not null;
create index if not exists inventory_supplier_target_venues_supplier_idx
  on public.inventory_supplier_target_venues(supplier_id);
create index if not exists inventory_supplier_target_venues_source_idx
  on public.inventory_supplier_target_venues(source_document_id)
  where source_document_id is not null;

alter table public.inventory_supplier_capabilities enable row level security;
alter table public.inventory_supplier_target_venues enable row level security;
revoke all on public.inventory_supplier_capabilities from public, anon, authenticated;
revoke all on public.inventory_supplier_target_venues from public, anon, authenticated;
grant select, insert, update, delete on public.inventory_supplier_capabilities to service_role;
grant select, insert, update, delete on public.inventory_supplier_target_venues to service_role;

with supplier as (
  select id from public.inventory_suppliers
  where lower(legal_name) = lower('Shenzhen Bajie Charging Technology Co., Ltd.')
  limit 1
)
insert into public.inventory_source_documents(
  supplier_id, source_reference, source_type, title, original_filename,
  document_date, page_count, verification_state, notes
)
select
  supplier.id,
  'bajie-official-website-contact-2026-08-11',
  'official_supplier_website',
  'BAJIE CHARGING — official website contact and business capabilities',
  null,
  date '2026-08-11',
  null,
  'verified',
  'Current official supplier website checked 2026-08-11. Verification means source/contact publication is confirmed; supplier marketing claims remain SUPPLIER_DECLARED.'
from supplier
on conflict (source_reference) do update
set supplier_id = excluded.supplier_id,
    source_type = excluded.source_type,
    title = excluded.title,
    document_date = excluded.document_date,
    verification_state = excluded.verification_state,
    notes = excluded.notes;

with supplier as (
  select id from public.inventory_suppliers
  where lower(legal_name) = lower('Shenzhen Bajie Charging Technology Co., Ltd.')
  limit 1
), source_doc as (
  select id from public.inventory_source_documents
  where source_reference = 'bajie-official-website-contact-2026-08-11'
)
insert into public.inventory_supplier_contacts(
  supplier_id, contact_role, name, job_title, email, phone, messaging_handle,
  language, verification_state, source_document_id, notes
)
select
  supplier.id,
  'general_sales_support',
  null,
  'General supplier contact',
  'info@chargenow.top',
  '+86 134 8460 4813',
  'WhatsApp: +86 134 8460 4813',
  null,
  'verified',
  source_doc.id,
  'Published on the official BAJIE CHARGING website. This is a general contact channel, not a named technical, spare-parts or RMA contact.'
from supplier cross join source_doc
where not exists (
  select 1 from public.inventory_supplier_contacts c
  where c.supplier_id = supplier.id
    and c.contact_role = 'general_sales_support'
    and c.email = 'info@chargenow.top'
    and c.phone = '+86 134 8460 4813'
);

with supplier as (
  select id from public.inventory_suppliers
  where lower(legal_name) = lower('Shenzhen Bajie Charging Technology Co., Ltd.')
  limit 1
), source_doc as (
  select id from public.inventory_source_documents
  where source_reference = 'bajie-official-website-contact-2026-08-11'
), capabilities(code, name, value, notes) as (
  values
    ('oem_branding','OEM branding',jsonb_build_object('declared',true),'Official website says OEM branding options are available.'),
    ('white_label','White-label branding',jsonb_build_object('declared',true),'Official website says white-label branding options are available.'),
    ('end_to_end_solution','End-to-end hardware and software solution',jsonb_build_object('declared',true),'Official website describes an end-to-end hardware + software solution.'),
    ('support_24_7','24/7 support',jsonb_build_object('declared',true),'Official website advertises dedicated 24/7 technical and operational support.')
)
insert into public.inventory_supplier_capabilities(
  supplier_id, capability_code, capability_name, value,
  verification_state, source_document_id, notes
)
select supplier.id, capabilities.code, capabilities.name, capabilities.value,
       'supplier_declared', source_doc.id, capabilities.notes
from supplier cross join source_doc cross join capabilities
on conflict (supplier_id, capability_code) do update
set capability_name = excluded.capability_name,
    value = excluded.value,
    verification_state = 'supplier_declared',
    source_document_id = excluded.source_document_id,
    notes = excluded.notes,
    updated_at = now();

with supplier as (
  select id from public.inventory_suppliers
  where lower(legal_name) = lower('Shenzhen Bajie Charging Technology Co., Ltd.')
  limit 1
), source_doc as (
  select id from public.inventory_source_documents
  where source_reference = 'bajie-official-website-contact-2026-08-11'
), venues(venue_type, claim) as (
  values
    ('shopping_mall','Supplier presents shopping malls as a target deployment venue.'),
    ('airport','Supplier presents airports as a target deployment venue.'),
    ('hotel','Supplier presents hotels as a target deployment venue.'),
    ('restaurant','Supplier presents restaurants as a target deployment venue.'),
    ('stadium','Supplier presents stadiums as a target deployment venue.'),
    ('gym','Supplier presents gyms as a target deployment venue.'),
    ('train_station','Supplier presents train stations as a target deployment venue.'),
    ('theme_park','Supplier presents theme parks as a target deployment venue.'),
    ('university','Supplier presents universities as a target deployment venue.')
)
insert into public.inventory_supplier_target_venues(
  supplier_id, venue_type, supplier_claim, verification_state,
  source_document_id, notes
)
select supplier.id, venues.venue_type, venues.claim, 'supplier_declared', source_doc.id,
       'Supplier-declared market fit; not independently validated by Chargeurs.ch.'
from supplier cross join source_doc cross join venues
on conflict (supplier_id, venue_type) do update
set supplier_claim = excluded.supplier_claim,
    verification_state = 'supplier_declared',
    source_document_id = excluded.source_document_id,
    notes = excluded.notes,
    updated_at = now();

comment on table public.inventory_supplier_capabilities is
  'Supplier-declared capabilities such as OEM/white-label/support; official source does not independently validate performance.';
comment on table public.inventory_supplier_target_venues is
  'Supplier-declared venue fit. Not a Chargeurs.ch commercial strategy or independently verified deployment result.';
