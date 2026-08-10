-- Dedicated, non-financial hardware qualification ledger for the DTA21269 pilot.
-- It is intentionally separate from rental_sessions/payments so FreePay tests can
-- never be mistaken for customer rentals or accounting events.

alter table public.stations
  add column if not exists qualification_mode text not null default 'disabled'
    check (qualification_mode in ('disabled', 'read_only', 'freepay_test', 'stripe_test', 'live')),
  add column if not exists qualification_updated_at timestamptz,
  add column if not exists qualification_updated_by uuid references auth.users(id) on delete set null;

update public.stations
set qualification_mode = case
      when station_id = 'DTA21269' and environment <> 'production' then 'read_only'
      else 'disabled'
    end,
    qualification_updated_at = now()
where station_id in ('DTA21269', 'DTA21277', 'DTA22032')
  and qualification_mode = 'disabled';

create table if not exists public.hardware_qualification_runs (
  id uuid primary key default gen_random_uuid(),
  station_id text not null references public.stations(station_id) on delete restrict,
  mode text not null check (mode in ('read_only', 'freepay_test')),
  state text not null default 'created' check (state in (
    'created',
    'inventory_confirmed',
    'order_created',
    'ejection_requested',
    'ejection_confirmed',
    'battery_taken',
    'return_confirmed',
    'completed',
    'failed',
    'cancelled',
    'needs_reconciliation'
  )),
  requested_slot_num integer check (requested_slot_num is null or requested_slot_num between 1 and 128),
  expected_battery_id text,
  observed_slot_num integer check (observed_slot_num is null or observed_slot_num between 0 and 128),
  observed_battery_id text,
  provider_trade_no text,
  provider_order_id text,
  initial_snapshot jsonb,
  latest_snapshot jsonb,
  provider_order_response jsonb,
  provider_ejection_response jsonb,
  failure_code text,
  failure_message text,
  started_by uuid references auth.users(id) on delete set null,
  command_sent_at timestamptz,
  ejection_confirmed_at timestamptz,
  return_confirmed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hardware_qualification_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.hardware_qualification_runs(id) on delete cascade,
  station_id text not null references public.stations(station_id) on delete restrict,
  event_type text not null,
  external_event_id text,
  provider_trade_no text,
  battery_id text,
  slot_num integer,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now()
);

create index if not exists hardware_qualification_runs_station_created_idx
  on public.hardware_qualification_runs(station_id, created_at desc);

create unique index if not exists hardware_qualification_one_active_run_idx
  on public.hardware_qualification_runs(station_id)
  where state in (
    'created', 'inventory_confirmed', 'order_created', 'ejection_requested',
    'ejection_confirmed', 'battery_taken', 'needs_reconciliation'
  );

create unique index if not exists hardware_qualification_events_external_idx
  on public.hardware_qualification_events(run_id, external_event_id)
  where external_event_id is not null;

alter table public.hardware_qualification_runs enable row level security;
alter table public.hardware_qualification_events enable row level security;

revoke all on public.hardware_qualification_runs from anon, authenticated;
revoke all on public.hardware_qualification_events from anon, authenticated;
grant all on public.hardware_qualification_runs to service_role;
grant all on public.hardware_qualification_events to service_role;

comment on table public.hardware_qualification_runs is
  'Non-financial DTA pilot tests. Never use these rows as customer rentals or payment evidence.';
comment on column public.stations.qualification_mode is
  'Fail-closed station rollout gate: disabled/read_only/freepay_test/stripe_test/live.';