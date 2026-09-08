-- AGENT 7 - Inventory & Supply Chain
-- Cover foreign keys used by supplier-catalog joins and referential checks.
-- Additive only; no runtime station/battery/rental tables are touched.

create index if not exists inventory_source_documents_supplier_idx
  on public.inventory_source_documents(supplier_id)
  where supplier_id is not null;

create index if not exists inventory_supplier_contacts_supplier_idx
  on public.inventory_supplier_contacts(supplier_id);

create index if not exists inventory_supplier_contacts_source_document_idx
  on public.inventory_supplier_contacts(source_document_id)
  where source_document_id is not null;

create index if not exists inventory_supplier_contact_targets_source_document_idx
  on public.inventory_supplier_contact_targets(source_document_id)
  where source_document_id is not null;

create index if not exists inventory_supplier_products_source_document_idx
  on public.inventory_supplier_products(source_document_id)
  where source_document_id is not null;
