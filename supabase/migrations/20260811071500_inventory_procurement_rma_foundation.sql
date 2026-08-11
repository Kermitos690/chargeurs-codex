-- AGENT 7 — Inventory & Supply Chain
-- Procurement, supplier-inquiry, spare-parts request, receiving and RMA foundation.
--
-- Invariants:
-- - a supplier inquiry is evidence of a request, not evidence that the supplier has answered;
-- - quoted catalog price != confirmed purchase price != landed cost;
-- - no purchase order is created from a catalog row automatically;
-- - no receipt creates serialized assets automatically;
-- - suspected defect != eligible/submitted RMA;
-- - an RMA may not progress beyond draft/eligibility_unknown until a real diagnosis
--   and supplier/model mapping exist;
-- - server-only domain. No runtime station/slot/battery, rental, payment, kiosk,
--   advertising or ChargeNow write path is introduced here.

create table if not exists public.inventory_supplier_inquiries (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.inventory_suppliers(id) on delete restrict,
  inquiry_type text not null check (inquiry_type in (
    'technical_bom_spares','commercial','rma','certification','logistics','other'
  )),
  subject text not null,
  sent_to text,
  channel text not null default 'email' check (channel in ('email','whatsapp','phone','portal','other')),
  status text not null default 'draft' check (status in (
    'draft','sent','acknowledged','partially_answered','answered','closed','failed'
  )),
  external_message_id text,
  external_thread_id text,
  request_body text,
  request_summary text,
  contact_verification_state text not null default 'unknown'
    check (contact_verification_state in ('verified','supplier_declared','observed','inferred','unknown')),
  sent_at timestamptz,
  acknowledged_at timestamptz,
  answered_at timestamptz,
  closed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel, external_message_id),
  check ((status = 'draft' and sent_at is null) or status <> 'draft')
);

create index if not exists inventory_supplier_inquiries_supplier_status_idx
  on public.inventory_supplier_inquiries(supplier_id, status, created_at desc);

create table if not exists public.inventory_supplier_inquiry_items (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.inventory_supplier_inquiries(id) on delete restrict,
  requirement_code text not null,
  requirement_name text not null,
  priority text not null default 'medium' check (priority in ('critical','high','medium','low')),
  status text not null default 'requested' check (status in (
    'requested','received','verified','rejected','not_available','not_applicable'
  )),
  response_text text,
  response_source_document_id uuid references public.inventory_source_documents(id) on delete restrict,
  verification_state text not null default 'unknown'
    check (verification_state in ('verified','supplier_declared','observed','inferred','unknown')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (inquiry_id, requirement_code)
);

create index if not exists inventory_supplier_inquiry_items_source_document_idx
  on public.inventory_supplier_inquiry_items(response_source_document_id)
  where response_source_document_id is not null;

create table if not exists public.inventory_spare_part_requests (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.inventory_suppliers(id) on delete restrict,
  inquiry_id uuid references public.inventory_supplier_inquiries(id) on delete restrict,
  parent_supplier_product_id uuid references public.inventory_supplier_products(id) on delete restrict,
  component_category text not null check (component_category in (
    'slot_ejector_lock','controller_pcb','charging_slot_pcb','power_supply',
    'display_touchscreen','communication_module','wiring_connector',
    'enclosure_stand','powerbank_component','other'
  )),
  requested_part_name text not null,
  requested_for_supplier_skus text[] not null default '{}'::text[],
  request_status text not null default 'requested' check (request_status in (
    'requested','supplier_responded','identified','not_available','closed'
  )),
  supplier_spare_sku text,
  supplier_part_name text,
  unit_cost numeric check (unit_cost is null or unit_cost >= 0),
  currency text,
  moq integer check (moq is null or moq > 0),
  lead_time_days integer check (lead_time_days is null or lead_time_days >= 0),
  compatibility_state text not null default 'unknown' check (compatibility_state in (
    'unknown','supplier_declared','verified','incompatible'
  )),
  verification_state text not null default 'unknown'
    check (verification_state in ('verified','supplier_declared','observed','inferred','unknown')),
  response_notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists inventory_spare_part_requests_supplier_status_idx
  on public.inventory_spare_part_requests(supplier_id, request_status, component_category);
create index if not exists inventory_spare_part_requests_inquiry_idx
  on public.inventory_spare_part_requests(inquiry_id)
  where inquiry_id is not null;
create index if not exists inventory_spare_part_requests_parent_product_idx
  on public.inventory_spare_part_requests(parent_supplier_product_id)
  where parent_supplier_product_id is not null;

create table if not exists public.inventory_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.inventory_suppliers(id) on delete restrict,
  po_number text not null unique,
  status text not null default 'draft' check (status in (
    'draft','awaiting_quote','approved','ordered','partially_received','received','cancelled'
  )),
  currency text not null,
  supplier_reference text,
  incoterm text,
  landed_cost_status text not null default 'unknown' check (landed_cost_status in (
    'unknown','partial','complete','final'
  )),
  ordered_at timestamptz,
  expected_at timestamptz,
  cancelled_at timestamptz,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'ordered' or ordered_at is not null)
);

create index if not exists inventory_purchase_orders_supplier_status_idx
  on public.inventory_purchase_orders(supplier_id, status, created_at desc);

create table if not exists public.inventory_purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.inventory_purchase_orders(id) on delete restrict,
  line_number integer not null check (line_number > 0),
  supplier_product_id uuid references public.inventory_supplier_products(id) on delete restrict,
  supplier_offer_id uuid references public.inventory_supplier_offers(id) on delete restrict,
  description text not null,
  quantity integer not null check (quantity > 0),
  unit_cost numeric not null check (unit_cost >= 0),
  currency text not null,
  source_price_state text not null default 'quoted' check (source_price_state in (
    'quoted','supplier_confirmed','invoiced','estimated'
  )),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (purchase_order_id, line_number)
);

create index if not exists inventory_purchase_order_lines_supplier_product_idx
  on public.inventory_purchase_order_lines(supplier_product_id)
  where supplier_product_id is not null;
create index if not exists inventory_purchase_order_lines_supplier_offer_idx
  on public.inventory_purchase_order_lines(supplier_offer_id)
  where supplier_offer_id is not null;

create table if not exists public.inventory_procurement_cost_components (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.inventory_purchase_orders(id) on delete restrict,
  component_type text not null check (component_type in (
    'freight','insurance','customs_duty','import_vat','brokerage','bank_fee','inspection','other'
  )),
  amount numeric not null check (amount >= 0),
  currency text not null,
  cost_state text not null default 'estimated' check (cost_state in (
    'estimated','quoted','confirmed','invoiced','paid'
  )),
  supplier_or_provider text,
  reference text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists inventory_procurement_cost_components_po_idx
  on public.inventory_procurement_cost_components(purchase_order_id, component_type);

create table if not exists public.inventory_receipts (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.inventory_purchase_orders(id) on delete restrict,
  receipt_number text not null unique,
  status text not null default 'draft' check (status in ('draft','received','inspected','closed')),
  receiving_location_id uuid references public.inventory_locations(id) on delete restrict,
  carrier_tracking text,
  packing_slip_reference text,
  received_at timestamptz,
  inspected_at timestamptz,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status = 'draft' or received_at is not null)
);

create index if not exists inventory_receipts_po_idx
  on public.inventory_receipts(purchase_order_id, created_at desc);
create index if not exists inventory_receipts_location_idx
  on public.inventory_receipts(receiving_location_id)
  where receiving_location_id is not null;

create table if not exists public.inventory_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.inventory_receipts(id) on delete restrict,
  purchase_order_line_id uuid not null references public.inventory_purchase_order_lines(id) on delete restrict,
  quantity_received integer not null check (quantity_received > 0),
  quantity_accepted integer not null default 0 check (quantity_accepted >= 0),
  quantity_quarantined integer not null default 0 check (quantity_quarantined >= 0),
  quantity_damaged integer not null default 0 check (quantity_damaged >= 0),
  serialized_asset_creation_state text not null default 'not_started' check (serialized_asset_creation_state in (
    'not_started','partial','complete','not_applicable'
  )),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (quantity_accepted + quantity_quarantined + quantity_damaged <= quantity_received)
);

create index if not exists inventory_receipt_lines_receipt_idx
  on public.inventory_receipt_lines(receipt_id);
create index if not exists inventory_receipt_lines_po_line_idx
  on public.inventory_receipt_lines(purchase_order_line_id);

create table if not exists public.inventory_rma_cases (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.inventory_assets(id) on delete restrict,
  defect_case_id uuid not null references public.inventory_defect_cases(id) on delete restrict,
  supplier_id uuid references public.inventory_suppliers(id) on delete restrict,
  supplier_product_id uuid references public.inventory_supplier_products(id) on delete restrict,
  status text not null default 'eligibility_unknown' check (status in (
    'eligibility_unknown','draft','submitted','approved','shipped','received_by_supplier',
    'repairing','replacement_pending','replaced','repaired','rejected','closed'
  )),
  warranty_state text not null default 'unknown' check (warranty_state in (
    'unknown','in_warranty','out_of_warranty','not_applicable'
  )),
  rma_reference text,
  supplier_case_reference text,
  opened_at timestamptz not null default now(),
  submitted_at timestamptz,
  shipped_at timestamptz,
  resolved_at timestamptz,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (defect_case_id)
);

create index if not exists inventory_rma_cases_asset_idx
  on public.inventory_rma_cases(asset_id, status);
create index if not exists inventory_rma_cases_supplier_idx
  on public.inventory_rma_cases(supplier_id, status)
  where supplier_id is not null;
create index if not exists inventory_rma_cases_supplier_product_idx
  on public.inventory_rma_cases(supplier_product_id)
  where supplier_product_id is not null;

create table if not exists public.inventory_rma_events (
  id uuid primary key default gen_random_uuid(),
  rma_case_id uuid not null references public.inventory_rma_cases(id) on delete restrict,
  event_type text not null check (event_type in (
    'OPENED','ELIGIBILITY_REVIEW','SUBMITTED','SUPPLIER_ACK','APPROVED','REJECTED',
    'SHIPPED','RECEIVED_BY_SUPPLIER','REPAIR_UPDATE','REPLACEMENT_UPDATE','RESOLVED','NOTE'
  )),
  occurred_at timestamptz not null default now(),
  actor_type text not null default 'service' check (actor_type in ('service','user','technician','supplier','system')),
  actor_reference text,
  details jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists inventory_rma_events_case_time_idx
  on public.inventory_rma_events(rma_case_id, occurred_at desc);

create or replace function public.inventory_validate_rma_case()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_defect public.inventory_defect_cases%rowtype;
  v_asset public.inventory_assets%rowtype;
begin
  select * into v_defect from public.inventory_defect_cases where id = new.defect_case_id;
  if not found then
    raise exception 'INVENTORY_RMA_DEFECT_CASE_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_defect.asset_id <> new.asset_id then
    raise exception 'INVENTORY_RMA_ASSET_DEFECT_MISMATCH' using errcode = 'P0001';
  end if;

  select * into v_asset from public.inventory_assets where id = new.asset_id;
  if not found then
    raise exception 'INVENTORY_RMA_ASSET_NOT_FOUND' using errcode = 'P0001';
  end if;

  if new.status not in ('eligibility_unknown','draft') then
    if v_defect.diagnostic_status not in ('diagnosed','irreparable','supplier_rma') then
      raise exception 'INVENTORY_RMA_DIAGNOSIS_REQUIRED' using errcode = 'P0001';
    end if;
    if new.supplier_id is null or new.supplier_product_id is null then
      raise exception 'INVENTORY_RMA_SUPPLIER_MODEL_MAPPING_REQUIRED' using errcode = 'P0001';
    end if;
  end if;

  if new.status in ('submitted','approved','shipped','received_by_supplier','repairing','replacement_pending','replaced','repaired','rejected','closed')
     and new.submitted_at is null then
    raise exception 'INVENTORY_RMA_SUBMITTED_AT_REQUIRED' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function public.inventory_validate_rma_case() from public, anon, authenticated;
grant execute on function public.inventory_validate_rma_case() to service_role;

drop trigger if exists inventory_validate_rma_case_trigger on public.inventory_rma_cases;
create trigger inventory_validate_rma_case_trigger
before insert or update on public.inventory_rma_cases
for each row execute function public.inventory_validate_rma_case();

create or replace function public.inventory_purchase_order_cost_summary(p_purchase_order_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with po as (
    select id, currency, landed_cost_status
    from public.inventory_purchase_orders
    where id = p_purchase_order_id
  ),
  lines as (
    select pol.currency, sum(pol.quantity * pol.unit_cost)::numeric as amount
    from public.inventory_purchase_order_lines pol
    where pol.purchase_order_id = p_purchase_order_id
    group by pol.currency
  ),
  extras as (
    select pc.currency,
           sum(pc.amount)::numeric as amount,
           jsonb_object_agg(pc.component_type, pc.amount order by pc.component_type) as components
    from public.inventory_procurement_cost_components pc
    where pc.purchase_order_id = p_purchase_order_id
    group by pc.currency
  ),
  currencies as (
    select currency from lines
    union
    select currency from extras
  )
  select case when exists (select 1 from po) then
    jsonb_build_object(
      'purchase_order_id', p_purchase_order_id,
      'landed_cost_status', (select landed_cost_status from po),
      'totals_by_currency', coalesce((
        select jsonb_object_agg(
          c.currency,
          jsonb_build_object(
            'hardware_total', coalesce(l.amount, 0),
            'known_cost_components_total', coalesce(e.amount, 0),
            'known_total', coalesce(l.amount, 0) + coalesce(e.amount, 0),
            'components', coalesce(e.components, '{}'::jsonb)
          )
        )
        from currencies c
        left join lines l using (currency)
        left join extras e using (currency)
      ), '{}'::jsonb),
      'note', 'Known-cost summary only. landed_cost_status must be explicitly advanced when freight/import/tax/etc. evidence is complete.'
    )
  else null end;
$$;

revoke all on function public.inventory_purchase_order_cost_summary(uuid) from public, anon, authenticated;
grant execute on function public.inventory_purchase_order_cost_summary(uuid) to service_role;

alter table public.inventory_supplier_inquiries enable row level security;
alter table public.inventory_supplier_inquiry_items enable row level security;
alter table public.inventory_spare_part_requests enable row level security;
alter table public.inventory_purchase_orders enable row level security;
alter table public.inventory_purchase_order_lines enable row level security;
alter table public.inventory_procurement_cost_components enable row level security;
alter table public.inventory_receipts enable row level security;
alter table public.inventory_receipt_lines enable row level security;
alter table public.inventory_rma_cases enable row level security;
alter table public.inventory_rma_events enable row level security;

revoke all on public.inventory_supplier_inquiries from public, anon, authenticated;
revoke all on public.inventory_supplier_inquiry_items from public, anon, authenticated;
revoke all on public.inventory_spare_part_requests from public, anon, authenticated;
revoke all on public.inventory_purchase_orders from public, anon, authenticated;
revoke all on public.inventory_purchase_order_lines from public, anon, authenticated;
revoke all on public.inventory_procurement_cost_components from public, anon, authenticated;
revoke all on public.inventory_receipts from public, anon, authenticated;
revoke all on public.inventory_receipt_lines from public, anon, authenticated;
revoke all on public.inventory_rma_cases from public, anon, authenticated;
revoke all on public.inventory_rma_events from public, anon, authenticated;

grant select, insert, update on public.inventory_supplier_inquiries to service_role;
grant select, insert, update on public.inventory_supplier_inquiry_items to service_role;
grant select, insert, update on public.inventory_spare_part_requests to service_role;
grant select, insert, update on public.inventory_purchase_orders to service_role;
grant select, insert, update on public.inventory_purchase_order_lines to service_role;
grant select, insert, update on public.inventory_procurement_cost_components to service_role;
grant select, insert, update on public.inventory_receipts to service_role;
grant select, insert, update on public.inventory_receipt_lines to service_role;
grant select, insert, update on public.inventory_rma_cases to service_role;
grant select, insert on public.inventory_rma_events to service_role;
