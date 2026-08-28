-- AGENT 7 - Inventory & Supply Chain
-- Bajie supplier master + source document + generic product families + contact targets.

insert into public.inventory_suppliers (
  legal_name, trade_name, manufacturer_name, country_code, website, address,
  status, verification_state, notes
) values (
  'Shenzhen Bajie Charging Technology Co., Ltd.',
  'BAJIE CHARGING',
  'Shenzhen Bajie Charging Technology Co., Ltd.',
  'CN',
  'www.bajie-charging.com',
  jsonb_build_object(
    'line1', 'Building 5, 2nd-4th Floors, Fuzhong Industrial Park',
    'community', 'Huaide Community',
    'subdistrict', 'Fuyong Subdistrict',
    'city', 'Shenzhen',
    'country', 'China'
  ),
  'active',
  'supplier_declared',
  'Supplier identity, website and address are transcribed from the user-provided quotation.'
)
on conflict ((lower(legal_name))) do update
set trade_name = excluded.trade_name,
    manufacturer_name = excluded.manufacturer_name,
    country_code = excluded.country_code,
    website = excluded.website,
    address = excluded.address,
    status = excluded.status,
    verification_state = excluded.verification_state,
    notes = excluded.notes,
    updated_at = now();

insert into public.inventory_source_documents (
  supplier_id, source_reference, source_type, title, original_filename,
  document_date, page_count, verification_state, notes
)
select
  s.id,
  'bajie-quotation-pdf-v1',
  'supplier_quotation',
  'BAJIE CHARGING Quotation',
  'Bajie Quotation.pdf',
  null,
  7,
  'supplier_declared',
  'User-provided 7-page quotation. The document itself shows no quotation date. Tax, freight and software are excluded; hardware only.'
from public.inventory_suppliers s
where lower(s.legal_name) = lower('Shenzhen Bajie Charging Technology Co., Ltd.')
on conflict (source_reference) do update
set supplier_id = excluded.supplier_id,
    source_type = excluded.source_type,
    title = excluded.title,
    original_filename = excluded.original_filename,
    document_date = excluded.document_date,
    page_count = excluded.page_count,
    verification_state = excluded.verification_state,
    notes = excluded.notes;

insert into public.inventory_products(code, name, product_type, status)
values
  ('SHARED_POWERBANK','Shared power bank','powerbank','candidate'),
  ('DESKTOP_SHARED_CHARGING_STATION_ADS','Desktop shared charging station with ADS','station','candidate'),
  ('DESKTOP_SHARED_CHARGING_STATION','Desktop shared charging station','station','candidate'),
  ('FLOOR_STANDING_SHARED_CHARGING_STATION_ADS','Floor-standing shared charging station with ADS','station','candidate'),
  ('OUTDOOR_WATERPROOF_SHARED_CHARGING_STATION','Outdoor / waterproof shared charging station','station','candidate'),
  ('MODULAR_CHARGING_STATION_ACCESSORY','Modular charging station accessory','accessory','candidate'),
  ('STATION_STAND','Charging station stand','stand','candidate'),
  ('POS_HARDWARE_OPTION','POS / payment hardware option','pos_hardware','candidate'),
  ('STATION_POS_ACCESSORY','POS / station accessory','accessory','candidate')
on conflict (code) do update
set name = excluded.name,
    product_type = excluded.product_type,
    updated_at = now();

with supplier as (
  select id from public.inventory_suppliers
  where lower(legal_name) = lower('Shenzhen Bajie Charging Technology Co., Ltd.')
  limit 1
), source_doc as (
  select id from public.inventory_source_documents where source_reference = 'bajie-quotation-pdf-v1'
)
insert into public.inventory_supplier_contact_targets(supplier_id, contact_role, status, source_document_id, notes)
select supplier.id, target.contact_role, target.status, source_doc.id, target.notes
from supplier cross join source_doc
cross join (values
  ('sales_business_manager','identified','Quotation says to contact the business manager, but no name or direct details are supplied.'),
  ('technical_hardware','unknown','Required for hardware revisions, BOM, component compatibility and defect escalation.'),
  ('spare_parts','unknown','Required to obtain exact spare-part SKUs, drawings and replacement compatibility.'),
  ('after_sales_rma','unknown','Required for warranty, DOA, repair and supplier-return workflows.'),
  ('firmware_software','unknown','Required only for supplier firmware/protocol questions; no contact is supplied in the quotation.'),
  ('logistics_export','unknown','Required for freight, Incoterms, packaging and lead-time confirmation.'),
  ('certification_compliance','unknown','Required to obtain actual certificates/test reports for quoted CE/FCC/RoHS/MSDS/UN38.3/IP54 claims.')
) as target(contact_role,status,notes)
on conflict (supplier_id, contact_role) do update
set status = excluded.status,
    source_document_id = excluded.source_document_id,
    notes = excluded.notes,
    updated_at = now();
