-- AGENT 7 — Inventory & Supply Chain
-- Staging validation for supplier inquiry, procurement, receiving and RMA guardrails.

-- Persistent operational evidence created outside this transaction:
-- one real outbound BAJIE inquiry with Gmail message id 19fef3eb676f6ac9.

do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.inventory_supplier_inquiries
  where channel='email'
    and external_message_id='19fef3eb676f6ac9'
    and sent_to='info@chargenow.top'
    and status='sent';
  if v_count <> 1 then
    raise exception 'INVENTORY_PROCUREMENT_TEST: expected one real sent supplier inquiry, got %', v_count;
  end if;

  select count(*) into v_count
  from public.inventory_supplier_inquiry_items x
  join public.inventory_supplier_inquiries i on i.id=x.inquiry_id
  where i.external_message_id='19fef3eb676f6ac9';
  if v_count <> 11 then
    raise exception 'INVENTORY_PROCUREMENT_TEST: expected 11 requested evidence items, got %', v_count;
  end if;

  select count(*) into v_count
  from public.inventory_spare_part_requests s
  join public.inventory_supplier_inquiries i on i.id=s.inquiry_id
  where i.external_message_id='19fef3eb676f6ac9';
  if v_count <> 9 then
    raise exception 'INVENTORY_PROCUREMENT_TEST: expected 9 spare-part categories, got %', v_count;
  end if;

  if exists (
    select 1 from public.inventory_spare_part_requests s
    join public.inventory_supplier_inquiries i on i.id=s.inquiry_id
    where i.external_message_id='19fef3eb676f6ac9'
      and (s.supplier_spare_sku is not null
           or s.unit_cost is not null
           or s.compatibility_state <> 'unknown')
  ) then
    raise exception 'INVENTORY_PROCUREMENT_TEST: supplier response data was invented before reply';
  end if;
end;
$$;

-- The current FECA02C714 case is only a suspected defect and must remain an
-- internal eligibility hold, never a supplier RMA submission.
do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.inventory_rma_cases r
  join public.inventory_assets a on a.id=r.asset_id
  join public.inventory_defect_cases d on d.id=r.defect_case_id
  where a.source_external_id='FECA02C714'
    and r.status='eligibility_unknown'
    and d.diagnostic_status='suspected'
    and r.supplier_id is null
    and r.supplier_product_id is null;
  if v_count <> 1 then
    raise exception 'INVENTORY_PROCUREMENT_TEST: expected one blocked FECA RMA eligibility hold, got %', v_count;
  end if;
end;
$$;

begin;

do $$
declare
  v_supplier_id uuid;
  v_product_id uuid;
  v_offer_id uuid;
  v_po_id uuid;
  v_summary jsonb;
  v_asset_id uuid;
  v_defect_id uuid;
  v_blocked boolean := false;
begin
  select id into v_supplier_id
  from public.inventory_suppliers
  where legal_name='Shenzhen Bajie Charging Technology Co., Ltd.'
  limit 1;

  select sp.id, o.id
    into v_product_id, v_offer_id
  from public.inventory_supplier_products sp
  join public.inventory_supplier_offers o on o.supplier_product_id=sp.id
  where sp.supplier_sku='ZBJ-SP04'
    and o.quantity_label='Sample'
    and o.unit_cost=121.00
    and o.currency='USD'
  limit 1;

  insert into public.inventory_purchase_orders(
    supplier_id, po_number, status, currency, landed_cost_status,
    notes, metadata
  ) values (
    v_supplier_id,
    'TEST-ROLLBACK-PO-ZBJ-SP04',
    'draft',
    'USD',
    'unknown',
    'Transactional test only — not a real Chargeurs.ch order',
    jsonb_build_object('test_only',true)
  ) returning id into v_po_id;

  insert into public.inventory_purchase_order_lines(
    purchase_order_id, line_number, supplier_product_id, supplier_offer_id,
    description, quantity, unit_cost, currency, source_price_state
  ) values (
    v_po_id, 1, v_product_id, v_offer_id,
    'ZBJ-SP04 supplier quotation sample price',
    1, 121.00, 'USD', 'quoted'
  );

  v_summary := public.inventory_purchase_order_cost_summary(v_po_id);

  if (v_summary->>'landed_cost_status') is distinct from 'unknown' then
    raise exception 'INVENTORY_PROCUREMENT_TEST: quoted hardware price was incorrectly promoted to landed cost';
  end if;

  if ((v_summary->'totals_by_currency'->'USD'->>'hardware_total')::numeric) <> 121.00 then
    raise exception 'INVENTORY_PROCUREMENT_TEST: expected quoted hardware subtotal USD 121';
  end if;

  if ((v_summary->'totals_by_currency'->'USD'->>'known_cost_components_total')::numeric) <> 0 then
    raise exception 'INVENTORY_PROCUREMENT_TEST: invented freight/import cost exists';
  end if;

  select d.asset_id, d.id into v_asset_id, v_defect_id
  from public.inventory_defect_cases d
  join public.inventory_assets a on a.id=d.asset_id
  where a.source_external_id='FECA02C714'
  order by d.opened_at desc
  limit 1;

  begin
    update public.inventory_rma_cases
    set status='submitted',
        supplier_id=v_supplier_id,
        supplier_product_id=v_product_id,
        submitted_at=now()
    where defect_case_id=v_defect_id;
  exception when others then
    if sqlerrm like '%INVENTORY_RMA_DIAGNOSIS_REQUIRED%' then
      v_blocked := true;
    else
      raise;
    end if;
  end;

  if not v_blocked then
    raise exception 'INVENTORY_PROCUREMENT_TEST: suspected defect was incorrectly allowed to submit RMA';
  end if;
end;
$$;

rollback;

-- Ensure the transactional PO never persisted.
do $$
begin
  if exists (select 1 from public.inventory_purchase_orders where po_number='TEST-ROLLBACK-PO-ZBJ-SP04') then
    raise exception 'INVENTORY_PROCUREMENT_TEST: transactional test PO leaked into staging';
  end if;
end;
$$;
