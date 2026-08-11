-- AGENT 7 - Inventory & Supply Chain
-- Staging/disposable database validation for serialized assets and movement ledger.
-- The movement test is rolled back; runtime stations/slots/batteries are never written.

select public.inventory_reconcile_runtime_hardware(
  array['DTA21269','DTA21277','DTA22032']::text[]
);

do $$
declare
  v_count integer;
  v_location_code text;
begin
  select count(*) into v_count
  from public.inventory_assets
  where source_system = 'runtime_station'
    and source_external_id in ('DTA21269','DTA21277','DTA22032');
  if v_count <> 3 then
    raise exception 'INVENTORY_ASSET_TEST: expected 3 known DTA station assets, got %', v_count;
  end if;

  select count(*) into v_count
  from public.inventory_assets
  where source_system = 'runtime_battery';
  if v_count <> (select count(*) from public.batteries) then
    raise exception 'INVENTORY_ASSET_TEST: runtime battery asset count differs from runtime battery table';
  end if;

  if exists (
    select 1 from public.inventory_assets
    where source_system in ('runtime_station','runtime_battery')
      and ownership_state <> 'unknown'
  ) then
    raise exception 'INVENTORY_ASSET_TEST: runtime observation incorrectly asserted ownership';
  end if;

  if exists (
    select 1 from public.inventory_assets
    where source_system in ('runtime_station','runtime_battery')
      and (product_variant_id is not null or supplier_product_id is not null)
  ) then
    raise exception 'INVENTORY_ASSET_TEST: runtime entity was guessed into supplier/model mapping';
  end if;

  if (select count(*) from public.inventory_asset_movements) <> 0 then
    raise exception 'INVENTORY_ASSET_TEST: runtime reconciliation fabricated historical movements';
  end if;

  select l.code into v_location_code
  from public.inventory_assets a
  join public.inventory_locations l on l.id = a.current_location_id
  where a.source_system = 'runtime_battery' and a.source_external_id = 'F0F000503E';
  if v_location_code is distinct from 'SLOT:DTA21269:2' then
    raise exception 'INVENTORY_ASSET_TEST: F0F000503E expected slot 2, got %', v_location_code;
  end if;

  select l.code into v_location_code
  from public.inventory_assets a
  join public.inventory_locations l on l.id = a.current_location_id
  where a.source_system = 'runtime_battery' and a.source_external_id = 'FECA02C714';
  if v_location_code is distinct from 'SLOT:DTA21269:3' then
    raise exception 'INVENTORY_ASSET_TEST: FECA02C714 expected slot 3, got %', v_location_code;
  end if;

  if (select lifecycle_status from public.inventory_assets
      where source_system='runtime_battery' and source_external_id='FECA02C714')
      is distinct from 'quarantined' then
    raise exception 'INVENTORY_ASSET_TEST: FECA02C714 runtime quarantine was not preserved';
  end if;

  select l.code into v_location_code
  from public.inventory_assets a
  join public.inventory_locations l on l.id = a.current_location_id
  where a.source_system = 'runtime_battery' and a.source_external_id = 'F0F0004F21';
  if v_location_code is distinct from 'UNLOCATED' then
    raise exception 'INVENTORY_ASSET_TEST: out-of-station battery location was invented: %', v_location_code;
  end if;

  if exists (
    select source_system, source_external_id
    from public.inventory_assets
    where source_external_id is not null
    group by source_system, source_external_id
    having count(*) > 1
  ) then
    raise exception 'INVENTORY_ASSET_TEST: duplicate runtime asset identity';
  end if;
end;
$$;

begin;

do $$
declare
  v_asset_id uuid;
  v_from uuid;
  v_to uuid;
  v_first jsonb;
  v_replay jsonb;
  v_count integer;
begin
  select a.id, a.current_location_id
    into v_asset_id, v_from
  from public.inventory_assets a
  where a.source_system = 'runtime_battery'
    and a.source_external_id = 'F0F000503E';

  select id into v_to from public.inventory_locations where code = 'UNLOCATED';

  v_first := public.inventory_record_asset_movement(
    v_asset_id,
    'MANUAL_CORRECTION',
    v_from,
    v_to,
    'inventory-test:F0F000503E:manual-correction',
    'unknown',
    'system',
    'inventory-test',
    'Transactional idempotence test',
    null,
    now()
  );

  v_replay := public.inventory_record_asset_movement(
    v_asset_id,
    'MANUAL_CORRECTION',
    v_from,
    v_to,
    'inventory-test:F0F000503E:manual-correction',
    'unknown',
    'system',
    'inventory-test',
    'Transactional idempotence test replay',
    null,
    now()
  );

  if coalesce((v_first->>'idempotent_replay')::boolean, true) then
    raise exception 'INVENTORY_ASSET_TEST: first movement unexpectedly marked replay';
  end if;
  if not coalesce((v_replay->>'idempotent_replay')::boolean, false) then
    raise exception 'INVENTORY_ASSET_TEST: duplicate movement was not idempotent';
  end if;

  select count(*) into v_count
  from public.inventory_asset_movements
  where idempotency_key = 'inventory-test:F0F000503E:manual-correction';
  if v_count <> 1 then
    raise exception 'INVENTORY_ASSET_TEST: duplicate movement rows created: %', v_count;
  end if;
end;
$$;

rollback;
