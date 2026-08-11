-- AGENT 7 - Inventory & Supply Chain
-- Validate current official supplier contact evidence without promoting supplier marketing claims.

do $$
declare
  v_supplier_id uuid;
  v_count integer;
  v_state text;
begin
  select id into v_supplier_id
  from public.inventory_suppliers
  where lower(legal_name)=lower('Shenzhen Bajie Charging Technology Co., Ltd.');

  if v_supplier_id is null then
    raise exception 'INVENTORY_CONTACT_TEST: supplier missing';
  end if;

  select count(*) into v_count
  from public.inventory_supplier_contacts
  where supplier_id=v_supplier_id
    and contact_role='general_sales_support'
    and email='info@chargenow.top'
    and phone='+86 134 8460 4813'
    and verification_state='verified';
  if v_count <> 1 then
    raise exception 'INVENTORY_CONTACT_TEST: verified official contact missing or duplicated';
  end if;

  select count(*) into v_count
  from public.inventory_supplier_capabilities
  where supplier_id=v_supplier_id;
  if v_count <> 4 then
    raise exception 'INVENTORY_CONTACT_TEST: expected 4 supplier capability claims, got %',v_count;
  end if;

  if exists (
    select 1 from public.inventory_supplier_capabilities
    where supplier_id=v_supplier_id and verification_state <> 'supplier_declared'
  ) then
    raise exception 'INVENTORY_CONTACT_TEST: supplier marketing claim promoted above SUPPLIER_DECLARED';
  end if;

  select count(*) into v_count
  from public.inventory_supplier_target_venues
  where supplier_id=v_supplier_id;
  if v_count <> 9 then
    raise exception 'INVENTORY_CONTACT_TEST: expected 9 supplier-declared target venues, got %',v_count;
  end if;

  if exists (
    select 1 from public.inventory_supplier_target_venues
    where supplier_id=v_supplier_id and verification_state <> 'supplier_declared'
  ) then
    raise exception 'INVENTORY_CONTACT_TEST: venue marketing claim promoted above SUPPLIER_DECLARED';
  end if;

  select verification_state into v_state
  from public.inventory_source_documents
  where source_reference='bajie-official-website-contact-2026-08-11';
  if v_state is distinct from 'verified' then
    raise exception 'INVENTORY_CONTACT_TEST: official website source not VERIFIED';
  end if;
end;
$$;
