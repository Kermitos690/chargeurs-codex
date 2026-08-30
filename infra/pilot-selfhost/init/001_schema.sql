create extension if not exists pgcrypto;

create table if not exists stations (
  station_id text primary key,
  cabinet_id text not null,
  name text not null,
  location_name text,
  status text,
  online boolean not null default false,
  rentable_count integer not null default 0,
  returnable_count integer not null default 0,
  total_count integer not null default 4,
  currency text not null default 'CHF',
  price_per_period numeric(10,2),
  last_sync_at timestamptz,
  environment text not null default 'staging',
  is_pilot boolean not null default false,
  pilot_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists kiosk_devices (
  id uuid primary key default gen_random_uuid(),
  station_id text not null references stations(station_id) on delete cascade,
  label text,
  token_hash text not null unique,
  active boolean not null default true,
  token_revoked boolean not null default false,
  token_expires_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists kiosk_devices_station_idx on kiosk_devices(station_id);

create table if not exists pilot_pricing_profiles (
  id uuid primary key default gen_random_uuid(),
  station_id text references stations(station_id) on delete cascade,
  name text not null,
  currency text not null default 'CHF',
  deposit_cents integer not null check (deposit_cents >= 0),
  total_cap_cents integer not null check (total_cap_cents >= 0),
  unreturned_total_cents integer not null check (unreturned_total_cents >= 0),
  unreturned_after_minutes integer not null check (unreturned_after_minutes > 0),
  profile_version integer not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists pilot_pricing_one_active_station_idx
  on pilot_pricing_profiles(coalesce(station_id, '__default__')) where active = true;

create table if not exists pilot_pricing_tiers (
  profile_id uuid not null references pilot_pricing_profiles(id) on delete cascade,
  upper_minutes integer not null check (upper_minutes > 0),
  total_cents integer not null check (total_cents > 0),
  primary key (profile_id, upper_minutes)
);

create table if not exists rental_sessions (
  id uuid primary key default gen_random_uuid(),
  station_id text not null references stations(station_id),
  kiosk_device_id uuid references kiosk_devices(id),
  public_session_code text unique,
  state text not null default 'created',
  selected_slot_num integer,
  battery_id text,
  currency text not null default 'CHF',
  pricing_snapshot jsonb,
  amount_expected numeric(10,2),
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  provider_trade_no text,
  idempotency_key text unique,
  expires_at timestamptz,
  paid_at timestamptz,
  ejected_at timestamptz,
  returned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists rental_sessions_station_state_idx on rental_sessions(station_id, state);

create table if not exists audit_logs (
  id bigint generated always as identity primary key,
  actor text,
  action text not null,
  target text,
  data jsonb,
  created_at timestamptz not null default now()
);

-- Non-secret station metadata copied from the current staging baseline.
insert into stations (station_id,cabinet_id,name,location_name,status,online,rentable_count,returnable_count,total_count,currency,price_per_period,last_sync_at,environment,is_pilot,pilot_enabled)
values
  ('DTA21269','DTA21269','Chargeurs.ch — Borne pilote DTA21269','Rte de Berne 222, 1066 Epalinges','online',true,4,0,4,'CHF',0.75,'2026-08-28T22:11:53.18889Z','staging',true,false),
  ('DTA21277','DTA21277','Chargeurs.ch — Borne DTA21277',null,'online',true,4,0,4,'CHF',0.75,'2026-08-28T22:10:05.967142Z','staging',false,false),
  ('DTA22032','DTA22032','Chargeurs.ch — Borne DTA22032',null,'maintenance',true,0,0,4,'CHF',0.75,'2026-08-28T22:11:49.501611Z','staging',false,false)
on conflict (station_id) do nothing;

with inserted as (
  insert into pilot_pricing_profiles (
    station_id,name,currency,deposit_cents,total_cap_cents,unreturned_total_cents,unreturned_after_minutes,profile_version,active
  )
  select null,'Chargeurs.ch Express Pilot','CHF',3000,3000,3000,4320,5,true
  where not exists (select 1 from pilot_pricing_profiles where station_id is null and active=true)
  returning id
), profile as (
  select id from inserted
  union all
  select id from pilot_pricing_profiles where station_id is null and active=true limit 1
)
insert into pilot_pricing_tiers(profile_id,upper_minutes,total_cents)
select profile.id, tier.upper_minutes, tier.total_cents
from profile
cross join (values (30,190),(120,390),(360,590),(1440,790)) as tier(upper_minutes,total_cents)
on conflict (profile_id,upper_minutes) do nothing;
