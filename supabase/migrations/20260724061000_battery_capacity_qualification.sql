-- Battery-by-battery qualification. Provider charge/voltage telemetry is kept
-- separate from measured usable capacity: a transient power level must never be
-- sold as a higher-capacity product.

alter table public.batteries
  add column if not exists model_code text,
  add column if not exists rated_capacity_mah integer check (rated_capacity_mah is null or rated_capacity_mah > 0),
  add column if not exists measured_capacity_mah integer check (measured_capacity_mah is null or measured_capacity_mah > 0),
  add column if not exists measured_energy_wh numeric check (measured_energy_wh is null or measured_energy_wh > 0),
  add column if not exists provider_metric_kind text not null default 'unknown'
    check (provider_metric_kind in ('unknown', 'charge_percent', 'voltage', 'capacity_hint')),
  add column if not exists qualification_status text not null default 'untested'
    check (qualification_status in ('untested', 'inventory_seen', 'provisional', 'verified', 'failed', 'quarantined')),
  add column if not exists capacity_confidence text not null default 'unknown'
    check (capacity_confidence in ('unknown', 'provider_only', 'label_verified', 'externally_measured')),
  add column if not exists commercial_tier text not null default 'unclassified'
    check (commercial_tier in ('unclassified', 'standard', 'plus', 'premium', 'quarantine')),
  add column if not exists pricing_eligible boolean not null default false,
  add column if not exists qualified_at timestamptz,
  add column if not exists qualified_by uuid references auth.users(id) on delete set null,
  add column if not exists quarantine_reason text;

create table if not exists public.battery_observations (
  id uuid primary key default gen_random_uuid(),
  battery_id text not null references public.batteries(battery_id) on delete cascade,
  station_id text references public.stations(station_id) on delete set null,
  slot_num integer check (slot_num is null or slot_num between 0 and 128),
  qualification_run_id uuid references public.hardware_qualification_runs(id) on delete set null,
  source text not null check (source in ('chargenow_status', 'ejection_response', 'return_event', 'label_entry', 'external_meter')),
  provider_metric_kind text not null default 'unknown'
    check (provider_metric_kind in ('unknown', 'charge_percent', 'voltage', 'capacity_hint')),
  provider_metric_value numeric,
  charge_percent numeric check (charge_percent is null or charge_percent between 0 and 100),
  voltage_v numeric check (voltage_v is null or voltage_v > 0),
  temperature_c numeric,
  measured_capacity_mah integer check (measured_capacity_mah is null or measured_capacity_mah > 0),
  measured_energy_wh numeric check (measured_energy_wh is null or measured_energy_wh > 0),
  raw_data jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create table if not exists public.battery_test_cycles (
  id uuid primary key default gen_random_uuid(),
  battery_id text not null references public.batteries(battery_id) on delete restrict,
  qualification_run_id uuid references public.hardware_qualification_runs(id) on delete set null,
  method text not null check (method in ('provider_cycle', 'label_verification', 'usb_load_meter', 'bench_discharge')),
  state text not null default 'planned'
    check (state in ('planned', 'in_progress', 'completed', 'invalid', 'failed')),
  started_at timestamptz,
  ended_at timestamptz,
  start_charge_percent numeric check (start_charge_percent is null or start_charge_percent between 0 and 100),
  end_charge_percent numeric check (end_charge_percent is null or end_charge_percent between 0 and 100),
  start_voltage_v numeric,
  end_voltage_v numeric,
  delivered_capacity_mah integer check (delivered_capacity_mah is null or delivered_capacity_mah > 0),
  delivered_energy_wh numeric check (delivered_energy_wh is null or delivered_energy_wh > 0),
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  meter_reference text,
  notes text,
  verified_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.battery_product_tiers (
  code text primary key check (code in ('standard', 'plus', 'premium')),
  public_name text not null,
  description text,
  minimum_verified_capacity_mah integer check (minimum_verified_capacity_mah is null or minimum_verified_capacity_mah > 0),
  price_profile_id uuid references public.price_profiles(id) on delete set null,
  active boolean not null default false,
  selectable_by_customer boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.battery_product_tiers(code, public_name, description, active, selectable_by_customer)
values
  ('standard', 'Standard', 'Batterie qualifiée pour le service courant.', false, false),
  ('plus', 'Plus', 'Capacité vérifiée supérieure au niveau Standard.', false, false),
  ('premium', 'Premium', 'Capacité vérifiée la plus élevée du parc.', false, false)
on conflict (code) do nothing;

create index if not exists battery_observations_battery_time_idx
  on public.battery_observations(battery_id, observed_at desc);
create index if not exists battery_observations_run_idx
  on public.battery_observations(qualification_run_id, observed_at);
create index if not exists battery_test_cycles_battery_idx
  on public.battery_test_cycles(battery_id, created_at desc);
create index if not exists batteries_qualification_tier_idx
  on public.batteries(qualification_status, commercial_tier, pricing_eligible);

alter table public.battery_observations enable row level security;
alter table public.battery_test_cycles enable row level security;
alter table public.battery_product_tiers enable row level security;

revoke all on public.battery_observations from anon, authenticated;
revoke all on public.battery_test_cycles from anon, authenticated;
revoke all on public.battery_product_tiers from anon, authenticated;
grant all on public.battery_observations to service_role;
grant all on public.battery_test_cycles to service_role;
grant all on public.battery_product_tiers to service_role;

comment on column public.batteries.pricing_eligible is
  'Must remain false until capacity is label-verified or externally measured and a commercial tier is explicitly approved.';
comment on table public.battery_observations is
  'Raw telemetry and measurements; provider power_level alone is not usable-capacity proof.';
comment on table public.battery_product_tiers is
  'Commercial tiers remain inactive until the entire pilot inventory and customer-selection flow are validated.';