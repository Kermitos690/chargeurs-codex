-- AGENT 7 - Inventory & Supply Chain
-- Defect suspicion, quarantine and repair-history foundation.
--
-- Runtime quarantine is evidence, not proof of hardware defect. This migration
-- therefore keeps quarantine and defect cases separate and never promotes a
-- suspected defect to confirmed/diagnosed/repaired automatically.

create table if not exists public.inventory_quarantine_cases (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.inventory_assets(id) on delete restrict,
  source text not null,
  source_reason_code text,
  source_observation jsonb not null default '{}'::jsonb,
  status text not null default 'active'
    check (status in ('active','released','converted_to_rma','closed')),
  verification_state text not null default 'observed'
    check (verification_state in ('verified','supplier_declared','observed','inferred','unknown')),
  opened_at timestamptz not null default now(),
  released_at timestamptz,
  release_reason text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists inventory_quarantine_active_asset_reason_uidx
  on public.inventory_quarantine_cases(asset_id, source, coalesce(source_reason_code,''))
  where status = 'active';
create index if not exists inventory_quarantine_asset_time_idx
  on public.inventory_quarantine_cases(asset_id, opened_at desc);

create table if not exists public.inventory_defect_cases (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.inventory_assets(id) on delete restrict,
  defect_category text not null default 'unknown'
    check (defect_category in ('battery_cell','charging','connector','communication','mechanical','cosmetic','pcb','station_slot','power_supply','display','cable','unknown')),
  severity text not null default 'unknown'
    check (severity in ('unknown','informational','minor','degraded','major','critical')),
  diagnostic_status text not null default 'suspected'
    check (diagnostic_status in ('suspected','reproduced','diagnosed','repaired','irreparable','supplier_rma','closed_no_fault')),
  source text not null,
  source_reason_code text,
  source_observation jsonb not null default '{}'::jsonb,
  verification_state text not null default 'observed'
    check (verification_state in ('verified','supplier_declared','observed','inferred','unknown')),
  opened_at timestamptz not null default now(),
  diagnosed_at timestamptz,
  resolved_at timestamptz,
  diagnosis text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists inventory_defect_open_source_uidx
  on public.inventory_defect_cases(asset_id, source, coalesce(source_reason_code,''))
  where diagnostic_status in ('suspected','reproduced','diagnosed','supplier_rma');
create index if not exists inventory_defect_asset_time_idx
  on public.inventory_defect_cases(asset_id, opened_at desc);
create index if not exists inventory_defect_status_idx
  on public.inventory_defect_cases(diagnostic_status, severity);

create table if not exists public.inventory_defect_events (
  id uuid primary key default gen_random_uuid(),
  defect_case_id uuid not null references public.inventory_defect_cases(id) on delete restrict,
  event_type text not null
    check (event_type in ('OBSERVATION','REPRODUCED','DIAGNOSIS','REPAIR_STARTED','PART_REPLACED','TEST_RESULT','REPAIRED','IRREPARABLE','RMA_OPENED','RMA_RETURNED','CLOSED_NO_FAULT','NOTE')),
  event_payload jsonb not null default '{}'::jsonb,
  actor_type text not null default 'service'
    check (actor_type in ('service','user','technician','supplier','system')),
  actor_reference text,
  external_event_id text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists inventory_defect_events_external_uidx
  on public.inventory_defect_events(defect_case_id, external_event_id)
  where external_event_id is not null;
create index if not exists inventory_defect_events_case_time_idx
  on public.inventory_defect_events(defect_case_id, occurred_at desc);

create table if not exists public.inventory_repair_actions (
  id uuid primary key default gen_random_uuid(),
  defect_case_id uuid not null references public.inventory_defect_cases(id) on delete restrict,
  action_type text not null
    check (action_type in ('inspection','diagnostic_test','cleaning','repair','component_replacement','firmware_check','functional_test','other')),
  component_asset_id uuid references public.inventory_assets(id) on delete restrict,
  part_reference text,
  result text,
  performed_by text,
  performed_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists inventory_repair_actions_case_time_idx
  on public.inventory_repair_actions(defect_case_id, performed_at desc);
create index if not exists inventory_repair_actions_component_idx
  on public.inventory_repair_actions(component_asset_id)
  where component_asset_id is not null;

alter table public.inventory_quarantine_cases enable row level security;
alter table public.inventory_defect_cases enable row level security;
alter table public.inventory_defect_events enable row level security;
alter table public.inventory_repair_actions enable row level security;

revoke all on public.inventory_quarantine_cases from public, anon, authenticated;
revoke all on public.inventory_defect_cases from public, anon, authenticated;
revoke all on public.inventory_defect_events from public, anon, authenticated;
revoke all on public.inventory_repair_actions from public, anon, authenticated;

grant select, insert, update on public.inventory_quarantine_cases to service_role;
grant select, insert, update on public.inventory_defect_cases to service_role;
grant select, insert on public.inventory_defect_events to service_role;
grant select, insert on public.inventory_repair_actions to service_role;

create or replace function public.inventory_reconcile_runtime_quarantines()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b record;
  v_asset_id uuid;
  v_q_id uuid;
  v_d_id uuid;
  v_quarantines integer := 0;
  v_suspected_defects integer := 0;
begin
  for b in
    select battery_id, qualification_status, quarantine_reason, station_id, slot_num,
           status, power_level, updated_at
    from public.batteries
    where qualification_status = 'quarantined'
       or quarantine_reason is not null
    order by battery_id
  loop
    select id into v_asset_id
    from public.inventory_assets
    where source_system = 'runtime_battery'
      and source_external_id = b.battery_id;

    if v_asset_id is null then
      continue;
    end if;

    insert into public.inventory_quarantine_cases(
      asset_id, source, source_reason_code, source_observation,
      status, verification_state, opened_at, notes
    ) values (
      v_asset_id,
      'runtime_battery',
      b.quarantine_reason,
      jsonb_build_object(
        'battery_id', b.battery_id,
        'qualification_status', b.qualification_status,
        'runtime_status', b.status,
        'station_id', b.station_id,
        'slot_num', b.slot_num,
        'power_level', b.power_level,
        'observed_at', b.updated_at
      ),
      'active',
      'observed',
      coalesce(b.updated_at, now()),
      'Runtime quarantine preserved as evidence; not equivalent to confirmed hardware defect.'
    )
    on conflict (asset_id, source, coalesce(source_reason_code,'')) where status = 'active'
    do update set
      source_observation = excluded.source_observation,
      verification_state = 'observed',
      updated_at = now()
    returning id into v_q_id;

    v_quarantines := v_quarantines + 1;

    -- Only an explicit runtime reason that itself states a suspected battery
    -- fault opens a defect case. Even then category/severity remain UNKNOWN and
    -- diagnostic_status stays SUSPECTED until actual diagnostics occur.
    if lower(coalesce(b.quarantine_reason,'')) like '%suspected_battery_fault%' then
      insert into public.inventory_defect_cases(
        asset_id, defect_category, severity, diagnostic_status,
        source, source_reason_code, source_observation,
        verification_state, opened_at, notes
      ) values (
        v_asset_id,
        'unknown',
        'unknown',
        'suspected',
        'runtime_battery',
        b.quarantine_reason,
        jsonb_build_object(
          'battery_id', b.battery_id,
          'qualification_status', b.qualification_status,
          'runtime_status', b.status,
          'station_id', b.station_id,
          'slot_num', b.slot_num,
          'power_level', b.power_level,
          'observed_at', b.updated_at
        ),
        'observed',
        coalesce(b.updated_at, now()),
        'Explicit runtime reason indicates suspected fault. No category, severity or diagnosis inferred.'
      )
      on conflict (asset_id, source, coalesce(source_reason_code,''))
        where diagnostic_status in ('suspected','reproduced','diagnosed','supplier_rma')
      do update set
        source_observation = excluded.source_observation,
        updated_at = now()
      returning id into v_d_id;

      insert into public.inventory_defect_events(
        defect_case_id, event_type, event_payload, actor_type,
        external_event_id, occurred_at
      ) values (
        v_d_id,
        'OBSERVATION',
        jsonb_build_object('source_reason_code', b.quarantine_reason, 'power_level', b.power_level),
        'system',
        'runtime-quarantine:' || b.battery_id || ':' || coalesce(b.quarantine_reason,'unknown'),
        coalesce(b.updated_at, now())
      ) on conflict (defect_case_id, external_event_id) where external_event_id is not null do nothing;

      v_suspected_defects := v_suspected_defects + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'active_runtime_quarantines_observed', v_quarantines,
    'suspected_defect_cases_observed', v_suspected_defects,
    'confirmed_defects_created', 0
  );
end;
$$;

revoke all on function public.inventory_reconcile_runtime_quarantines()
  from public, anon, authenticated;
grant execute on function public.inventory_reconcile_runtime_quarantines()
  to service_role;

comment on table public.inventory_quarantine_cases is
  'Quarantine evidence is separate from defect diagnosis. A quarantine must never automatically mean defective.';
comment on table public.inventory_defect_cases is
  'AGENT 7 defect lifecycle. Runtime evidence may open SUSPECTED only; confirmation requires diagnostics.';
comment on function public.inventory_reconcile_runtime_quarantines() is
  'Imports runtime quarantine evidence without auto-confirming defects or resolving cases.';
