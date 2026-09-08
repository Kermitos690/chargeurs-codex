-- AGENT 7 - Inventory & Supply Chain
-- Post-migration assertions for the supplier catalog foundation.
-- Run only on a disposable/test database or approved staging environment.

begin;

do $$
declare
  v_supplier_id uuid;
  v_count integer;
begin
  select id into v_supplier_id
  from public.inventory_suppliers
  where lower(legal_name) = lower('Shenzhen Bajie Charging Technology Co., Ltd.');

  if v_supplier_id is null then
    raise exception 'INVENTORY_TEST: Bajie supplier missing';
  end if;

  select count(*) into v_count
  from public.inventory_supplier_contact_targets
  where supplier_id = v_supplier_id;
  if v_count <> 7 then
    raise exception 'INVENTORY_TEST: expected 7 supplier contact targets, got %', v_count;
  end if;

  select count(*) into v_count
  from public.inventory_supplier_products
  where supplier_id = v_supplier_id;
  if v_count <> 55 then
    raise exception 'INVENTORY_TEST: expected 55 normalized catalog entries, got %', v_count;
  end if;

  select count(*) into v_count
  from public.inventory_supplier_offers o
  join public.inventory_supplier_products sp on sp.id = o.supplier_product_id
  where sp.supplier_id = v_supplier_id;
  if v_count <> 116 then
    raise exception 'INVENTORY_TEST: expected 116 explicit supplier offers/configurations, got %', v_count;
  end if;

  select count(*) into v_count
  from public.inventory_supplier_products
  where supplier_id = v_supplier_id
    and procurement_mode = 'local_purchase';
  if v_count <> 5 then
    raise exception 'INVENTORY_TEST: expected 5 page-6 local-purchase POS options, got %', v_count;
  end if;

  if exists (
    select 1 from public.inventory_supplier_products
    where supplier_id = v_supplier_id
      and verification_state <> 'supplier_declared'
  ) then
    raise exception 'INVENTORY_TEST: supplier quotation data was promoted above SUPPLIER_DECLARED';
  end if;

  if exists (
    select 1 from public.inventory_product_variants v
    join public.inventory_supplier_products sp on sp.product_variant_id = v.id
    where sp.supplier_id = v_supplier_id
      and v.status <> 'candidate'
  ) then
    raise exception 'INVENTORY_TEST: supplier catalog variant incorrectly activated as Chargeurs.ch product';
  end if;

  if exists (
    select 1 from public.inventory_supplier_offers o
    join public.inventory_supplier_products sp on sp.id = o.supplier_product_id
    where sp.supplier_id = v_supplier_id
      and o.unit_cost < 0
  ) then
    raise exception 'INVENTORY_TEST: negative supplier cost detected';
  end if;

  if exists (
    select supplier_variant_key
    from public.inventory_supplier_products
    where supplier_id = v_supplier_id
    group by supplier_variant_key
    having count(*) > 1
  ) then
    raise exception 'INVENTORY_TEST: duplicate supplier variant key';
  end if;

  if exists (
    select internal_code
    from public.inventory_product_variants
    group by internal_code
    having count(*) > 1
  ) then
    raise exception 'INVENTORY_TEST: duplicate internal variant code';
  end if;

  select count(*) into v_count
  from public.inventory_supplier_products
  where supplier_id = v_supplier_id and supplier_sku = 'ZBJ-166';
  if v_count <> 2 then
    raise exception 'INVENTORY_TEST: ZBJ-166 touch/non-touch variants were incorrectly merged';
  end if;

  select count(*) into v_count
  from public.inventory_supplier_products
  where supplier_id = v_supplier_id and supplier_sku = 'BJD001';
  if v_count <> 2 then
    raise exception 'INVENTORY_TEST: BJD001 touch/non-touch variants were incorrectly merged';
  end if;

  select count(*) into v_count
  from public.inventory_supplier_products
  where supplier_id = v_supplier_id and supplier_sku = 'ZBJ-166-3';
  if v_count <> 2 then
    raise exception 'INVENTORY_TEST: ZBJ-166-3 touch/non-touch variants were incorrectly merged';
  end if;

  if exists (
    select 1
    from public.inventory_supplier_offers o
    join public.inventory_supplier_products sp on sp.id = o.supplier_product_id
    where sp.supplier_id = v_supplier_id
      and sp.supplier_sku = 'ZBJ-SP-M'
      and o.configuration_label = 'DC12V/10A'
  ) then
    raise exception 'INVENTORY_TEST: invented ZBJ-SP-M 10A price detected';
  end if;

  if exists (
    select 1
    from public.inventory_supplier_products sp
    where sp.supplier_id = v_supplier_id
      and sp.supplier_sku = 'ZBJ-166-2'
      and coalesce(sp.supplier_specifications->>'certification', '') ilike '%IP54%'
  ) then
    raise exception 'INVENTORY_TEST: ZBJ-166-2 was incorrectly promoted to IP54';
  end if;
end;
$$;

rollback;
