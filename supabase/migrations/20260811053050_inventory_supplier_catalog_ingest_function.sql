-- AGENT 7 - Inventory & Supply Chain
-- Private ingestion primitive for supplier catalog snapshots.
-- The caller may supply supplier-declared data only; this function never promotes
-- catalog rows to VERIFIED/ACTIVE and never creates owned inventory assets.

create or replace function public.inventory_ingest_supplier_catalog(
  p_supplier_legal_name text,
  p_source_reference text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_supplier_id uuid;
  v_source_document_id uuid;
  v_item_count integer;
  v_offer_count integer;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'INVENTORY_CATALOG_ITEMS_MUST_BE_ARRAY' using errcode = 'P0001';
  end if;

  select id into v_supplier_id
  from public.inventory_suppliers
  where lower(legal_name) = lower(p_supplier_legal_name)
  limit 1;

  if v_supplier_id is null then
    raise exception 'INVENTORY_SUPPLIER_NOT_FOUND' using errcode = 'P0001';
  end if;

  select id into v_source_document_id
  from public.inventory_source_documents
  where source_reference = p_source_reference
    and supplier_id = v_supplier_id
  limit 1;

  if v_source_document_id is null then
    raise exception 'INVENTORY_SOURCE_DOCUMENT_NOT_FOUND' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as c(product_code text)
    left join public.inventory_products p on p.code = c.product_code
    where p.id is null
  ) then
    raise exception 'INVENTORY_UNKNOWN_PRODUCT_CODE' using errcode = 'P0001';
  end if;

  insert into public.inventory_product_variants(
    product_id, internal_code, normalized_name, attributes, status, verification_state
  )
  select
    p.id,
    c.variant_code,
    c.normalized_name,
    coalesce(c.attributes, '{}'::jsonb),
    'candidate',
    'supplier_declared'
  from jsonb_to_recordset(p_items) as c(
    variant_code text,
    product_code text,
    normalized_name text,
    attributes jsonb
  )
  join public.inventory_products p on p.code = c.product_code
  on conflict (internal_code) do update
  set product_id = excluded.product_id,
      normalized_name = excluded.normalized_name,
      attributes = excluded.attributes,
      verification_state = 'supplier_declared',
      updated_at = now();

  insert into public.inventory_supplier_products(
    supplier_id, product_variant_id, source_document_id, supplier_sku,
    supplier_variant_key, supplier_product_name, catalog_section, source_page,
    procurement_mode, status, verification_state, supplier_specifications, notes
  )
  select
    v_supplier_id,
    v.id,
    v_source_document_id,
    c.supplier_sku,
    c.supplier_variant_key,
    c.supplier_product_name,
    c.catalog_section,
    c.source_page,
    coalesce(c.procurement_mode, 'unknown'),
    'quoted',
    'supplier_declared',
    coalesce(c.attributes, '{}'::jsonb),
    c.notes
  from jsonb_to_recordset(p_items) as c(
    variant_code text,
    supplier_sku text,
    supplier_variant_key text,
    supplier_product_name text,
    catalog_section text,
    source_page integer,
    procurement_mode text,
    attributes jsonb,
    notes text
  )
  join public.inventory_product_variants v on v.internal_code = c.variant_code
  on conflict (supplier_id, supplier_variant_key) do update
  set product_variant_id = excluded.product_variant_id,
      source_document_id = excluded.source_document_id,
      supplier_sku = excluded.supplier_sku,
      supplier_product_name = excluded.supplier_product_name,
      catalog_section = excluded.catalog_section,
      source_page = excluded.source_page,
      procurement_mode = excluded.procurement_mode,
      status = 'quoted',
      verification_state = 'supplier_declared',
      supplier_specifications = excluded.supplier_specifications,
      notes = excluded.notes,
      updated_at = now();

  insert into public.inventory_supplier_offers(
    supplier_product_id, offer_key, quantity_label, quantity_min, quantity_max,
    configuration_label, unit_cost, currency, verification_state, notes
  )
  select
    sp.id,
    offer_item->>'offer_key',
    nullif(offer_item->>'quantity_label', ''),
    nullif(offer_item->>'quantity_min', '')::integer,
    nullif(offer_item->>'quantity_max', '')::integer,
    nullif(offer_item->>'configuration_label', ''),
    nullif(offer_item->>'unit_cost', '')::numeric,
    coalesce(nullif(offer_item->>'currency', ''), 'USD'),
    'supplier_declared',
    nullif(offer_item->>'notes', '')
  from jsonb_to_recordset(p_items) as c(
    supplier_variant_key text,
    offers jsonb
  )
  join public.inventory_supplier_products sp
    on sp.supplier_id = v_supplier_id
   and sp.supplier_variant_key = c.supplier_variant_key
  cross join lateral jsonb_array_elements(coalesce(c.offers, '[]'::jsonb)) as offer_item
  on conflict (supplier_product_id, offer_key) do update
  set quantity_label = excluded.quantity_label,
      quantity_min = excluded.quantity_min,
      quantity_max = excluded.quantity_max,
      configuration_label = excluded.configuration_label,
      unit_cost = excluded.unit_cost,
      currency = excluded.currency,
      verification_state = 'supplier_declared',
      notes = excluded.notes,
      updated_at = now();

  v_item_count := jsonb_array_length(p_items);
  select coalesce(sum(jsonb_array_length(coalesce(c.offers, '[]'::jsonb))), 0)::integer
    into v_offer_count
  from jsonb_to_recordset(p_items) as c(offers jsonb);

  return jsonb_build_object(
    'supplier_id', v_supplier_id,
    'source_document_id', v_source_document_id,
    'items_ingested', v_item_count,
    'offers_ingested', v_offer_count,
    'verification_state', 'supplier_declared'
  );
end;
$$;

revoke all on function public.inventory_ingest_supplier_catalog(text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.inventory_ingest_supplier_catalog(text,text,jsonb)
  to service_role;

comment on function public.inventory_ingest_supplier_catalog(text,text,jsonb) is
  'AGENT 7 private supplier-catalog ingestion. Enforces candidate/SUPPLIER_DECLARED state and cannot create owned assets.';
