-- AGENT 7 - Inventory & Supply Chain
-- Serialized asset, physical-location and movement-ledger foundation.
--
-- Boundary:
-- - reads existing runtime `stations`, `slots` and `batteries` only through the
--   explicit reconciliation function below;
-- - never writes to those runtime tables;
-- - never calls ChargeNow or any hardware command;
-- - runtime identifiers are aliases, never assumed to be manufacturer serials;
-- - observed runtime entities start with ownership UNKNOWN and no supplier/model
--   mapping unless independent evidence is added later.

create table if not exists public.inventory_locations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  location_type text not null check (location_type in (
    'supplier','warehouse','workshop','transit','partner_site','station','slot',
    'customer_b2b','rma','scrap','unlocated'
  )),
  parent_location_id uuid references public.inventory_locations(id) on delete restrict,
  external_station_id text,
  slot_num integer check (slot_num is null or slot_num between 1 and 128),
  status text not null default 'active' check (status in ('active','inactive','retired')),
  verification_state text not null default 'unknown'
    check (verification_state in ('verified','supplier_declared','observed','inferred','unknown')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((location_type = 'slot') = (slot_num is not null))
);

create index if not exists inventory_locations_parent_idx
  on public.inventory_locations(parent_location_id)
  where parent_location_id is not null;
create index if not exists inventory_locations_external_station_idx
  on public.inventory_locations(external_station_id)
  where external_station_id is not null;

create table if not exists public.inventory_assets (
  id uuid primary key default gen_random_uuid(),
  asset_code text not null unique,
  asset_type text not null check (asset_type in (
    'station','powerbank','component','accessory','spare_part','consumable','equipment'
  )),
  product_variant_id uuid references public.inventory_product_variants(id) on delete restrict,
  supplier_product_id uuid references public.inventory_supplier_products(id) on delete restrict,
  manufacturer_serial text,
  source_system text not null default 'manual'
    check (source_system in ('runtime_station','runtime_battery','manual','supplier_receipt','other')),
  source_external_id text,
  ownership_state text not null default 'unknown'
    check (ownership_state in ('unknown','owned','leased','consigned','customer_owned','supplier_owned')),
  lifecycle_status text not null default 'unknown'
    check (lifecycle_status in (
      'ordered','in_transit','received','available','reserved','deployed','in_use',
      'maintenance','quarantined','defective','rma','lost','retired','scrapped','unknown'
    )),
  current_location_id uuid references public.inventory_locations(id) on delete restrict,
  verification_state text not null default 'unknown'
    check (verification_state in ('verified','supplier_declared','observed','inferred','unknown')),
  first_observed_at timestamptz,
  last_observed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_system, source_external_id)
);

create index if not exists inventory_assets_product_variant_idx
  on public.inventory_assets(product_variant_id)
  where product_variant_id is not null;
create index if not exists inventory_assets_supplier_product_idx
  on public.inventory_assets(supplier_product_id)
  where supplier_product_id is not null;
create index if not exists inventory_assets_current_location_idx
  on public.inventory_assets(current_location_id)
  where current_location_id is not null;
create index if not exists inventory_assets_type_lifecycle_idx
  on public.inventory_assets(asset_type, lifecycle_status);

create table if not exists public.inventory_asset_identifiers (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.inventory_assets(id) on delete restrict,
  identifier_type text not null,
  identifier_value text not null,
  verification_state text not null default 'unknown'
    check (verification_state in ('verified','supplier_declared','observed','inferred','unknown')),
  source text,
  created_at timestamptz not null default now(),
  unique (asset_id, identifier_type, identifier_value)
);

create index if not exists inventory_asset_identifiers_lookup_idx
  on public.inventory_asset_identifiers(identifier_type, identifier_value);

create table if not exists public.inventory_asset_movements (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.inventory_assets(id) on delete restrict,
  event_type text not null check (event_type in (
    'PURCHASE_RECEIPT','WAREHOUSE_TRANSFER','STATION_ASSIGNMENT','SLOT_INSERTION',
    'SLOT_REMOVAL','MAINTENANCE_TRANSFER','CUSTOMER_SALE','SUPPLIER_RETURN',
    'LOSS','SCRAP','MANUAL_CORRECTION'
  )),
  from_location_id uuid references public.inventory_locations(id) on delete restrict,
  to_location_id uuid not null references public.inventory_locations(id) on delete restrict,
  lifecycle_before text,
  lifecycle_after text,
  occurred_at timestamptz not null default now(),
  actor_type text not null default 'service' check (actor_type in ('service','user','technician','supplier','system')),
  actor_reference text,
  reason text,
  external_reference text,
  idempotency_key text not null unique,
  state_before jsonb not null default '{}'::jsonb,
  state_after jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists inventory_asset_movements_asset_time_idx
  on public.inventory_asset_movements(asset_id, occurred_at desc);
create index if not exists inventory_asset_movements_from_idx
  on public.inventory_asset_movements(from_location_id)
  where from_location_id is not null;
create index if not exists inventory_asset_movements_to_idx
  on public.inventory_asset_movements(to_location_id);

create table if not exists public.inventory_runtime_observations (
  id uuid primary key default gen_random_uuid(),
  source_system text not null check (source_system in ('runtime_station','runtime_battery')),
  entity_type text not null check (entity_type in ('station','powerbank')),
  external_id text not null,
  asset_id uuid not null references public.inventory_assets(id) on delete restrict,
  observation_key text not null,
  observed_at timestamptz not null,
  station_id text,
  slot_num integer check (slot_num is null or slot_num between 1 and 128),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (source_system, external_id, observation_key)
);

create index if not exists inventory_runtime_observations_asset_time_idx
  on public.inventory_runtime_observations(asset_id, observed_at desc);
create index if not exists inventory_runtime_observations_station_slot_idx
  on public.inventory_runtime_observations(station_id, slot_num)
  where station_id is not null;

alter table public.inventory_locations enable row level security;
alter table public.inventory_assets enable row level security;
alter table public.inventory_asset_identifiers enable row level security;
alter table public.inventory_asset_movements enable row level security;
alter table public.inventory_runtime_observations enable row level security;

revoke all on public.inventory_locations from public, anon, authenticated;
revoke all on public.inventory_assets from public, anon, authenticated;
revoke all on public.inventory_asset_identifiers from public, anon, authenticated;
revoke all on public.inventory_asset_movements from public, anon, authenticated;
revoke all on public.inventory_runtime_observations from public, anon, authenticated;

grant select, insert, update, delete on public.inventory_locations to service_role;
grant select, insert, update, delete on public.inventory_assets to service_role;
grant select, insert, update, delete on public.inventory_asset_identifiers to service_role;
grant select, insert on public.inventory_asset_movements to service_role;
grant select, insert on public.inventory_runtime_observations to service_role;

create or replace function public.inventory_record_asset_movement(
  p_asset_id uuid,
  p_event_type text,
  p_from_location_id uuid,
  p_to_location_id uuid,
  p_idempotency_key text,
  p_target_lifecycle_status text default null,
  p_actor_type text default 'service',
  p_actor_reference text default null,
  p_reason text default null,
  p_external_reference text default null,
  p_occurred_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset public.inventory_assets%rowtype;
  v_existing public.inventory_asset_movements%rowtype;
  v_after_lifecycle text;
  v_movement_id uuid;
begin
  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 4 then
    raise exception 'INVENTORY_IDEMPOTENCY_KEY_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_existing
  from public.inventory_asset_movements
  where idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object(
      'movement_id', v_existing.id,
      'asset_id', v_existing.asset_id,
      'idempotent_replay', true
    );
  end if;

  if p_to_location_id is null then
    raise exception 'INVENTORY_DESTINATION_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_asset
  from public.inventory_assets
  where id = p_asset_id
  for update;
  if not found then
    raise exception 'INVENTORY_ASSET_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_asset.current_location_id is distinct from p_from_location_id then
    raise exception 'INVENTORY_SOURCE_LOCATION_MISMATCH' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.inventory_locations where id = p_to_location_id) then
    raise exception 'INVENTORY_DESTINATION_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_after_lifecycle := coalesce(p_target_lifecycle_status, v_asset.lifecycle_status);

  insert into public.inventory_asset_movements(
    asset_id, event_type, from_location_id, to_location_id,
    lifecycle_before, lifecycle_after, occurred_at, actor_type, actor_reference,
    reason, external_reference, idempotency_key, state_before, state_after
  ) values (
    v_asset.id, p_event_type, p_from_location_id, p_to_location_id,
    v_asset.lifecycle_status, v_after_lifecycle, coalesce(p_occurred_at, now()),
    coalesce(p_actor_type, 'service'), p_actor_reference, p_reason,
    p_external_reference, p_idempotency_key,
    jsonb_build_object(
      'location_id', v_asset.current_location_id,
      'lifecycle_status', v_asset.lifecycle_status
    ),
    jsonb_build_object(
      'location_id', p_to_location_id,
      'lifecycle_status', v_after_lifecycle
    )
  ) returning id into v_movement_id;

  update public.inventory_assets
  set current_location_id = p_to_location_id,
      lifecycle_status = v_after_lifecycle,
      updated_at = now()
  where id = v_asset.id;

  return jsonb_build_object(
    'movement_id', v_movement_id,
    'asset_id', v_asset.id,
    'idempotent_replay', false
  );
end;
$$;

revoke all on function public.inventory_record_asset_movement(
  uuid,text,uuid,uuid,text,text,text,text,text,text,timestamptz
) from public, anon, authenticated;
grant execute on function public.inventory_record_asset_movement(
  uuid,text,uuid,uuid,text,text,text,text,text,text,timestamptz
) to service_role;

create or replace function public.inventory_reconcile_runtime_hardware(
  p_station_ids text[] default array['DTA21269','DTA21277','DTA22032']::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  st record;
  sl record;
  b record;
  v_site_location_id uuid;
  v_station_location_id uuid;
  v_slot_location_id uuid;
  v_unlocated_id uuid;
  v_asset_id uuid;
  v_asset_code text;
  v_payload jsonb;
  v_observation_key text;
  v_observed_at timestamptz;
  v_match_count integer;
  v_match_station text;
  v_match_slot integer;
  v_target_location_id uuid;
  v_lifecycle text;
  v_station_assets integer := 0;
  v_powerbank_assets integer := 0;
  v_location_conflicts integer := 0;
begin
  if p_station_ids is null or cardinality(p_station_ids) = 0 then
    raise exception 'INVENTORY_RUNTIME_STATION_SCOPE_REQUIRED' using errcode = 'P0001';
  end if;

  insert into public.inventory_locations(
    code, name, location_type, status, verification_state, metadata
  ) values (
    'UNLOCATED', 'Emplacement physique non déterminé', 'unlocated', 'active', 'verified',
    jsonb_build_object('purpose','Do not invent warehouse/site location when runtime evidence is insufficient')
  )
  on conflict (code) do update
  set name = excluded.name,
      status = 'active',
      metadata = excluded.metadata,
      updated_at = now()
  returning id into v_unlocated_id;

  for st in
    select station_id, cabinet_id, name, location_name, status, online,
           total_count, rentable_count, returnable_count, last_sync_at
    from public.stations
    where station_id = any(p_station_ids)
    order by station_id
  loop
    insert into public.inventory_locations(
      code, name, location_type, external_station_id, status, verification_state, metadata
    ) values (
      'SITE:' || st.station_id,
      coalesce(nullif(st.location_name,''), 'Site observé ' || st.station_id),
      'partner_site', st.station_id, 'active', 'observed',
      jsonb_build_object('runtime_location_name', st.location_name, 'source', 'stations.location_name')
    )
    on conflict (code) do update
    set name = excluded.name,
        external_station_id = excluded.external_station_id,
        verification_state = 'observed',
        metadata = excluded.metadata,
        updated_at = now()
    returning id into v_site_location_id;

    insert into public.inventory_locations(
      code, name, location_type, parent_location_id, external_station_id,
      status, verification_state, metadata
    ) values (
      'STATION:' || st.station_id,
      coalesce(nullif(st.name,''), 'Station ' || st.station_id),
      'station', v_site_location_id, st.station_id,
      'active', 'observed', jsonb_build_object('runtime_station_id', st.station_id)
    )
    on conflict (code) do update
    set name = excluded.name,
        parent_location_id = excluded.parent_location_id,
        external_station_id = excluded.external_station_id,
        verification_state = 'observed',
        metadata = excluded.metadata,
        updated_at = now()
    returning id into v_station_location_id;

    v_asset_code := 'STN-' || st.station_id;
    v_observed_at := coalesce(st.last_sync_at, now());
    v_payload := jsonb_build_object(
      'station_id', st.station_id,
      'cabinet_id', st.cabinet_id,
      'name', st.name,
      'location_name', st.location_name,
      'status', st.status,
      'online', st.online,
      'total_count', st.total_count,
      'rentable_count', st.rentable_count,
      'returnable_count', st.returnable_count,
      'last_sync_at', st.last_sync_at
    );

    insert into public.inventory_assets(
      asset_code, asset_type, source_system, source_external_id, ownership_state,
      lifecycle_status, current_location_id, verification_state,
      first_observed_at, last_observed_at, metadata
    ) values (
      v_asset_code, 'station', 'runtime_station', st.station_id, 'unknown',
      case when st.online is true then 'deployed' else 'unknown' end,
      v_site_location_id, 'observed', v_observed_at, v_observed_at,
      jsonb_build_object(
        'runtime_station_id', st.station_id,
        'runtime_cabinet_id', st.cabinet_id,
        'runtime_status', st.status,
        'ownership_note', 'UNKNOWN until acquisition/ownership evidence is linked',
        'product_mapping_note', 'UNKNOWN; runtime station is not mapped to a supplier model by appearance'
      )
    )
    on conflict (source_system, source_external_id) do update
    set current_location_id = excluded.current_location_id,
        lifecycle_status = excluded.lifecycle_status,
        verification_state = 'observed',
        last_observed_at = excluded.last_observed_at,
        metadata = excluded.metadata,
        updated_at = now()
    returning id into v_asset_id;

    insert into public.inventory_asset_identifiers(
      asset_id, identifier_type, identifier_value, verification_state, source
    ) values (
      v_asset_id, 'runtime_station_id', st.station_id, 'observed', 'public.stations'
    ) on conflict do nothing;

    v_observation_key := coalesce(st.last_sync_at::text, 'no-sync') || ':' || md5(v_payload::text);
    insert into public.inventory_runtime_observations(
      source_system, entity_type, external_id, asset_id, observation_key,
      observed_at, station_id, payload
    ) values (
      'runtime_station', 'station', st.station_id, v_asset_id, v_observation_key,
      v_observed_at, st.station_id, v_payload
    ) on conflict (source_system, external_id, observation_key) do nothing;

    v_station_assets := v_station_assets + 1;

    for sl in
      select slot_num, status, battery_id
      from public.slots
      where station_id = st.station_id
      order by slot_num
    loop
      insert into public.inventory_locations(
        code, name, location_type, parent_location_id, external_station_id,
        slot_num, status, verification_state, metadata
      ) values (
        'SLOT:' || st.station_id || ':' || sl.slot_num::text,
        'Slot ' || sl.slot_num::text || ' — ' || st.station_id,
        'slot', v_station_location_id, st.station_id, sl.slot_num,
        'active', 'observed', jsonb_build_object(
          'runtime_slot_status', sl.status,
          'runtime_battery_id', sl.battery_id
        )
      )
      on conflict (code) do update
      set parent_location_id = excluded.parent_location_id,
          external_station_id = excluded.external_station_id,
          slot_num = excluded.slot_num,
          verification_state = 'observed',
          metadata = excluded.metadata,
          updated_at = now();
    end loop;
  end loop;

  -- Every runtime battery is an OBSERVED physical identity, but this does not
  -- claim Chargeurs.ch ownership or supplier/model compatibility.
  for b in
    select battery_id, station_id, slot_num, status, power_level, updated_at,
           model_code, qualification_status, capacity_confidence, quarantine_reason
    from public.batteries
    order by battery_id
  loop
    select count(*), min(s.station_id), min(s.slot_num)
      into v_match_count, v_match_station, v_match_slot
    from public.slots s
    where s.battery_id = b.battery_id
      and s.station_id = any(p_station_ids);

    if v_match_count = 1 then
      select id into v_target_location_id
      from public.inventory_locations
      where code = 'SLOT:' || v_match_station || ':' || v_match_slot::text;
    else
      v_target_location_id := v_unlocated_id;
      if v_match_count > 1 then
        v_location_conflicts := v_location_conflicts + 1;
      end if;
    end if;

    if b.qualification_status = 'quarantined' then
      v_lifecycle := 'quarantined';
    elsif v_match_count = 1 then
      v_lifecycle := 'deployed';
    else
      v_lifecycle := 'unknown';
    end if;

    v_asset_code := 'PB-' || b.battery_id;
    v_observed_at := coalesce(b.updated_at, now());
    v_payload := jsonb_build_object(
      'battery_id', b.battery_id,
      'runtime_station_id', b.station_id,
      'runtime_slot_num', b.slot_num,
      'runtime_status', b.status,
      'power_level', b.power_level,
      'model_code', b.model_code,
      'qualification_status', b.qualification_status,
      'capacity_confidence', b.capacity_confidence,
      'quarantine_reason', b.quarantine_reason,
      'slot_match_count', v_match_count,
      'resolved_station_id', case when v_match_count = 1 then v_match_station else null end,
      'resolved_slot_num', case when v_match_count = 1 then v_match_slot else null end
    );

    insert into public.inventory_assets(
      asset_code, asset_type, source_system, source_external_id, ownership_state,
      lifecycle_status, current_location_id, verification_state,
      first_observed_at, last_observed_at, metadata
    ) values (
      v_asset_code, 'powerbank', 'runtime_battery', b.battery_id, 'unknown',
      v_lifecycle, v_target_location_id, 'observed', v_observed_at, v_observed_at,
      jsonb_build_object(
        'runtime_battery_id', b.battery_id,
        'runtime_status', b.status,
        'power_level', b.power_level,
        'qualification_status', b.qualification_status,
        'capacity_confidence', b.capacity_confidence,
        'quarantine_reason', b.quarantine_reason,
        'observed_model_code', b.model_code,
        'location_conflict', v_match_count > 1,
        'ownership_note', 'UNKNOWN until acquisition/ownership evidence is linked',
        'product_mapping_note', 'UNKNOWN; model_code is observation only until mapped with evidence'
      )
    )
    on conflict (source_system, source_external_id) do update
    set current_location_id = excluded.current_location_id,
        lifecycle_status = excluded.lifecycle_status,
        verification_state = 'observed',
        last_observed_at = excluded.last_observed_at,
        metadata = excluded.metadata,
        updated_at = now()
    returning id into v_asset_id;

    insert into public.inventory_asset_identifiers(
      asset_id, identifier_type, identifier_value, verification_state, source
    ) values (
      v_asset_id, 'runtime_battery_id', b.battery_id, 'observed', 'public.batteries'
    ) on conflict do nothing;

    v_observation_key := b.updated_at::text || ':' || md5(v_payload::text);
    insert into public.inventory_runtime_observations(
      source_system, entity_type, external_id, asset_id, observation_key,
      observed_at, station_id, slot_num, payload
    ) values (
      'runtime_battery', 'powerbank', b.battery_id, v_asset_id, v_observation_key,
      v_observed_at,
      case when v_match_count = 1 then v_match_station else null end,
      case when v_match_count = 1 then v_match_slot else null end,
      v_payload
    ) on conflict (source_system, external_id, observation_key) do nothing;

    v_powerbank_assets := v_powerbank_assets + 1;
  end loop;

  return jsonb_build_object(
    'station_assets_observed', v_station_assets,
    'powerbank_assets_observed', v_powerbank_assets,
    'location_conflicts', v_location_conflicts,
    'ownership_state', 'unknown',
    'supplier_model_mapping', 'unknown'
  );
end;
$$;

revoke all on function public.inventory_reconcile_runtime_hardware(text[])
  from public, anon, authenticated;
grant execute on function public.inventory_reconcile_runtime_hardware(text[])
  to service_role;

comment on table public.inventory_assets is
  'AGENT 7 serialized asset registry. Runtime IDs are aliases and ownership/model remain UNKNOWN until evidence exists.';
comment on table public.inventory_asset_movements is
  'Immutable serialized-asset movement ledger. Initial runtime observation is not backfilled as a fictional movement.';
comment on table public.inventory_runtime_observations is
  'Read-only projection evidence copied from runtime station/battery state into Inventory without modifying hardware runtime.';
comment on function public.inventory_reconcile_runtime_hardware(text[]) is
  'AGENT 7 read-only runtime reconciliation into Inventory. Never writes stations/slots/batteries and never commands hardware.';
