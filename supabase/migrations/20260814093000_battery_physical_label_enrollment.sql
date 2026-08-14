-- Physical labels are an operational identity only. They deliberately live
-- outside rentals, payments and settlement so an inventory enrollment can
-- never close, bill, refund or otherwise alter a customer transaction.

create table if not exists public.battery_physical_labels (
  id uuid primary key default gen_random_uuid(),
  battery_id text not null references public.batteries(battery_id) on delete restrict,
  label_code text not null,
  observed_station_id text references public.stations(station_id) on delete restrict,
  observed_slot_num integer check (observed_slot_num is null or observed_slot_num between 1 and 128),
  observed_at timestamptz not null,
  verification_state text not null default 'operator_confirmed'
    check (verification_state in ('operator_confirmed', 'superseded', 'voided')),
  notes text,
  assigned_by uuid references auth.users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  superseded_at timestamptz,
  superseded_by uuid references auth.users(id) on delete set null,
  supersession_reason text,
  created_at timestamptz not null default now(),
  check (label_code = upper(label_code)),
  check (label_code ~ '^[A-Z0-9][A-Z0-9-]{1,31}$')
);

-- A printed code identifies exactly one currently enrolled physical unit;
-- likewise, a detected provider battery can have only one current sticker.
create unique index if not exists battery_physical_labels_active_code_idx
  on public.battery_physical_labels(label_code)
  where verification_state = 'operator_confirmed';
create unique index if not exists battery_physical_labels_active_battery_idx
  on public.battery_physical_labels(battery_id)
  where verification_state = 'operator_confirmed';
create index if not exists battery_physical_labels_battery_history_idx
  on public.battery_physical_labels(battery_id, assigned_at desc);

alter table public.battery_physical_labels enable row level security;
revoke all on public.battery_physical_labels from public, anon, authenticated;
grant select, insert, update on public.battery_physical_labels to service_role;

comment on table public.battery_physical_labels is
  'Operator-confirmed mapping between an adhesive physical label and the provider battery ID. This ledger must never be used as rental, return, payment or settlement evidence.';
