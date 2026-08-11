-- AGENT 7 - Inventory & Supply Chain
-- Validate quarantine != confirmed defect and preserve suspected-only semantics.

select public.inventory_reconcile_runtime_quarantines();

do $$
declare
  v_count integer;
  v_status text;
  v_category text;
  v_severity text;
begin
  select count(*) into v_count
  from public.inventory_quarantine_cases
  where status = 'active' and source = 'runtime_battery';
  if v_count <> 2 then
    raise exception 'INVENTORY_DEFECT_TEST: expected 2 active runtime quarantine cases, got %', v_count;
  end if;

  select count(*) into v_count
  from public.inventory_defect_cases
  where source = 'runtime_battery';
  if v_count <> 1 then
    raise exception 'INVENTORY_DEFECT_TEST: expected exactly 1 runtime suspected defect case, got %', v_count;
  end if;

  select d.diagnostic_status, d.defect_category, d.severity
    into v_status, v_category, v_severity
  from public.inventory_defect_cases d
  join public.inventory_assets a on a.id = d.asset_id
  where a.source_system = 'runtime_battery'
    and a.source_external_id = 'FECA02C714';

  if v_status is distinct from 'suspected' then
    raise exception 'INVENTORY_DEFECT_TEST: FECA02C714 was promoted beyond suspected: %', v_status;
  end if;
  if v_category is distinct from 'unknown' then
    raise exception 'INVENTORY_DEFECT_TEST: FECA02C714 category was guessed: %', v_category;
  end if;
  if v_severity is distinct from 'unknown' then
    raise exception 'INVENTORY_DEFECT_TEST: FECA02C714 severity was guessed: %', v_severity;
  end if;

  if exists (
    select 1
    from public.inventory_defect_cases d
    join public.inventory_assets a on a.id = d.asset_id
    where a.source_system = 'runtime_battery'
      and a.source_external_id = 'F0F0004F21'
  ) then
    raise exception 'INVENTORY_DEFECT_TEST: provider 2009 quarantine was incorrectly turned into battery defect';
  end if;

  if exists (
    select 1 from public.inventory_defect_cases
    where diagnostic_status in ('diagnosed','repaired','irreparable','supplier_rma')
  ) then
    raise exception 'INVENTORY_DEFECT_TEST: runtime import auto-confirmed or auto-resolved defect';
  end if;

  select count(*) into v_count
  from public.inventory_defect_events e
  join public.inventory_defect_cases d on d.id = e.defect_case_id
  join public.inventory_assets a on a.id = d.asset_id
  where a.source_external_id = 'FECA02C714'
    and e.event_type = 'OBSERVATION';
  if v_count <> 1 then
    raise exception 'INVENTORY_DEFECT_TEST: expected exactly one idempotent observation event, got %', v_count;
  end if;
end;
$$;

-- Re-run to prove import idempotence.
select public.inventory_reconcile_runtime_quarantines();

do $$
declare v_count integer;
begin
  select count(*) into v_count from public.inventory_quarantine_cases where status='active' and source='runtime_battery';
  if v_count <> 2 then raise exception 'INVENTORY_DEFECT_TEST: quarantine reconciliation duplicated cases'; end if;
  select count(*) into v_count from public.inventory_defect_cases where source='runtime_battery';
  if v_count <> 1 then raise exception 'INVENTORY_DEFECT_TEST: defect reconciliation duplicated cases'; end if;
  select count(*) into v_count from public.inventory_defect_events where external_event_id like 'runtime-quarantine:%';
  if v_count <> 1 then raise exception 'INVENTORY_DEFECT_TEST: observation reconciliation duplicated events'; end if;
end;
$$;
