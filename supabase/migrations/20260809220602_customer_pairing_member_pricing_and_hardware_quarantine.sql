-- Chargeurs.ch customer journey v1 + physical-release safety.
--
-- This migration introduces two independent concerns:
-- 1. a short-lived, station-bound account pairing used by the kiosk/app flow;
-- 2. a hardware quarantine + release observation ledger so one supplier command
--    can never be treated as a normal rental when more than one compartment
--    physically changes to empty.
--
-- No ChargeNow mutation is performed by this migration.

-- ---------------------------------------------------------------------------
-- Customer account pairing
-- ---------------------------------------------------------------------------
create table if not exists public.customer_pairing_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  station_id text not null references public.stations(station_id) on update cascade on delete cascade,
  kiosk_device_id uuid not null references public.kiosk_devices(id) on update cascade on delete cascade,
  customer_user_id uuid references auth.users(id) on update cascade on delete set null,
  state text not null default 'pending' check (state in ('pending','claimed','consumed','expired','cancelled')),
  segment text not null default 'member' check (segment in ('member')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  claimed_at timestamptz,
  consumed_at timestamptz,
  cancelled_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists customer_pairing_sessions_station_state_idx
  on public.customer_pairing_sessions(station_id, state, expires_at desc);
create index if not exists customer_pairing_sessions_device_state_idx
  on public.customer_pairing_sessions(kiosk_device_id, state, expires_at desc);
create unique index if not exists customer_pairing_sessions_active_device_uidx
  on public.customer_pairing_sessions(kiosk_device_id)
  where state in ('pending','claimed');

alter table public.customer_pairing_sessions enable row level security;
revoke all on table public.customer_pairing_sessions from public, anon, authenticated;
grant select, insert, update, delete on table public.customer_pairing_sessions to service_role;

-- A pairing can be used by at most one rental. The kiosk never supplies a raw
-- customer id: create-rental-session obtains it from the claimed pairing row.
alter table public.rental_sessions
  add column if not exists customer_segment text not null default 'guest'
    check (customer_segment in ('guest','member')),
  add column if not exists customer_pairing_session_id uuid
    references public.customer_pairing_sessions(id) on update cascade on delete set null;

create unique index if not exists rental_sessions_customer_pairing_uidx
  on public.rental_sessions(customer_pairing_session_id)
  where customer_pairing_session_id is not null;

-- ---------------------------------------------------------------------------
-- Segment-aware price mapping
-- ---------------------------------------------------------------------------
create table if not exists public.customer_segment_price_profiles (
  station_id text not null references public.stations(station_id) on update cascade on delete cascade,
  segment text not null check (segment in ('guest','member')),
  price_profile_id uuid not null references public.price_profiles(id) on update cascade on delete restrict,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (station_id, segment)
);

alter table public.customer_segment_price_profiles enable row level security;
revoke all on table public.customer_segment_price_profiles from public, anon, authenticated;
grant select, insert, update, delete on table public.customer_segment_price_profiles to service_role;

-- Preserve the existing DTA21269 pilot profile as the guest/blue price.
insert into public.customer_segment_price_profiles(station_id, segment, price_profile_id, active)
select 'DTA21269', 'guest', pa.price_profile_id, true
from public.price_assignments pa
where pa.scope = 'station'
  and pa.scope_ref = 'DTA21269'
  and pa.active = true
order by pa.updated_at desc
limit 1
on conflict (station_id, segment) do update
set price_profile_id = excluded.price_profile_id,
    active = true,
    updated_at = now();

-- Member/green pilot price: 1.00 CHF/h, still billed in 30-minute periods.
-- The 30 CHF payment security amount and 99 CHF non-return ceiling are kept
-- unchanged for the first pilot so the customer benefit is pricing, not weaker
-- loss protection. The values remain ordinary editable price-profile data.
insert into public.price_profiles(
  name, amount, currency, period_label, is_default, active, description,
  priority, version, initial_fee_cents, included_minutes, period_minutes,
  price_per_period_cents, grace_minutes, daily_cap_cents, total_cap_cents,
  max_amount_cents, deposit_cents, late_fee_cents, unreturned_fee_cents,
  unreturned_after_minutes, min_amount_cents, rounding, tax_percent
)
select
  'Chargeurs.ch Client', 0.50, 'CHF', 'par 30 min', false, true,
  'Tarif client connecté : 1,00 CHF/heure, incréments de 30 minutes.',
  110, 1, 0, 0, 30, 50, 0, 1200, 0, 9900, 3000, 0, 9900, 0, 0, 'none', 0
where not exists (
  select 1 from public.price_profiles
  where name = 'Chargeurs.ch Client' and active = true
);

insert into public.customer_segment_price_profiles(station_id, segment, price_profile_id, active)
select 'DTA21269', 'member', pp.id, true
from public.price_profiles pp
where pp.name = 'Chargeurs.ch Client' and pp.active = true
order by pp.created_at desc
limit 1
on conflict (station_id, segment) do update
set price_profile_id = excluded.price_profile_id,
    active = true,
    updated_at = now();

create or replace function public.resolve_customer_price_profile(
  p_station text,
  p_segment text
)
returns table(profile_id uuid, source text)
language plpgsql
stable
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_segment not in ('guest','member') then
    return;
  end if;

  select m.price_profile_id into v_id
  from public.customer_segment_price_profiles m
  join public.price_profiles pp on pp.id = m.price_profile_id
  where m.station_id = p_station
    and m.segment = p_segment
    and m.active = true
    and pp.active = true
    and (pp.valid_from is null or pp.valid_from <= now())
    and (pp.valid_to is null or pp.valid_to >= now())
  limit 1;

  if v_id is not null then
    profile_id := v_id;
    source := 'customer_segment:' || p_segment;
    return next;
    return;
  end if;

  -- Guest keeps backward compatibility with the ordinary station pricing.
  -- A member never silently falls back to the guest price: if the member price
  -- is missing, the server refuses the member rental instead of overcharging.
  if p_segment = 'guest' then
    select r.profile_id, r.source into profile_id, source
    from public.resolve_price_profile(null, p_station, null) r
    limit 1;
    if profile_id is not null then return next; end if;
  end if;
end;
$$;

revoke all on function public.resolve_customer_price_profile(text,text) from public, anon, authenticated;
grant execute on function public.resolve_customer_price_profile(text,text) to service_role;

-- Same billing rules as compute_pricing(), but the profile is selected from the
-- server-verified customer segment. The resulting JSON is a complete immutable
-- rental snapshot, so settlement never has to trust the kiosk segment later.
create or replace function public.compute_customer_pricing_snapshot(
  p_station text,
  p_segment text,
  p_start timestamptz,
  p_end timestamptz,
  p_rental_state text,
  p_return_state text,
  p_currency text
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  r record;
  pp public.price_profiles%rowtype;
  v_start timestamptz := coalesce(p_start, now());
  v_total_min int := 0;
  v_billable_min int := 0;
  v_periods int := 0;
  v_initial int;
  v_duration int;
  v_fees int := 0;
  v_subtotal int;
  v_capped int;
  v_caps jsonb := '[]'::jsonb;
  v_days int;
  v_tax int;
  v_final int;
  v_currency text;
begin
  select * into r from public.resolve_customer_price_profile(p_station, p_segment) limit 1;
  if r.profile_id is null then
    raise exception 'PRICING_NOT_CONFIGURED';
  end if;

  select * into pp from public.price_profiles where id = r.profile_id;
  if pp.id is null then raise exception 'PRICING_NOT_CONFIGURED'; end if;

  v_currency := coalesce(pp.currency, 'CHF');
  if p_currency is not null and upper(p_currency) <> upper(v_currency) then
    raise exception 'CURRENCY_MISMATCH';
  end if;

  if p_end is null then
    v_periods := case when pp.price_per_period_cents > 0 then 1 else 0 end;
  else
    v_total_min := greatest(0, ceil(extract(epoch from (p_end - v_start)) / 60.0)::int);
    if v_total_min <= pp.included_minutes + pp.grace_minutes then
      v_billable_min := 0;
    else
      v_billable_min := v_total_min - pp.included_minutes;
    end if;
    v_periods := case when v_billable_min > 0
      then ceil(v_billable_min::numeric / pp.period_minutes)::int else 0 end;
  end if;

  v_initial := pp.initial_fee_cents;
  v_duration := v_periods * pp.price_per_period_cents;
  if p_return_state = 'late' then v_fees := v_fees + pp.late_fee_cents; end if;
  if p_return_state = 'not_returned'
     or (pp.unreturned_after_minutes > 0 and v_total_min > pp.unreturned_after_minutes) then
    v_fees := v_fees + pp.unreturned_fee_cents;
  end if;

  v_subtotal := v_initial + v_duration + v_fees;
  v_capped := v_subtotal;
  if pp.daily_cap_cents > 0 then
    v_days := greatest(1, ceil(v_total_min::numeric / 1440)::int);
    if v_capped > pp.daily_cap_cents * v_days then
      v_capped := pp.daily_cap_cents * v_days;
      v_caps := v_caps || jsonb_build_object('type','daily','value',pp.daily_cap_cents * v_days);
    end if;
  end if;
  if pp.total_cap_cents > 0 and v_capped > pp.total_cap_cents then
    v_capped := pp.total_cap_cents;
    v_caps := v_caps || jsonb_build_object('type','total','value',pp.total_cap_cents);
  end if;
  if pp.max_amount_cents > 0 and v_capped > pp.max_amount_cents then
    v_capped := pp.max_amount_cents;
    v_caps := v_caps || jsonb_build_object('type','max','value',pp.max_amount_cents);
  end if;
  if pp.min_amount_cents > 0 and v_capped < pp.min_amount_cents then
    v_capped := pp.min_amount_cents;
    v_caps := v_caps || jsonb_build_object('type','min','value',pp.min_amount_cents);
  end if;
  if pp.rounding = 'up_5' then v_capped := ceil(v_capped::numeric / 5) * 5;
  elsif pp.rounding = 'up_10' then v_capped := ceil(v_capped::numeric / 10) * 10;
  end if;

  v_tax := round(v_capped * pp.tax_percent / 100.0)::int;
  v_final := v_capped + v_tax;

  return jsonb_build_object(
    'profile_id', pp.id,
    'profile_name', pp.name,
    'profile_version', pp.version,
    'source', r.source,
    'customer_segment', p_segment,
    'currency', v_currency,
    'start', v_start,
    'end', p_end,
    'rental_state', p_rental_state,
    'return_state', p_return_state,
    'total_minutes', v_total_min,
    'billed_periods', v_periods,
    'initial_fee_cents', v_initial,
    'duration_cents', v_duration,
    'additional_fees_cents', v_fees,
    'subtotal_cents', v_subtotal,
    'caps_applied', v_caps,
    'tax_percent', pp.tax_percent,
    'tax_cents', v_tax,
    'final_cents', v_final,
    'amount', round(v_final::numeric / 100, 2),
    'pricing_rules_version', 2,
    'included_minutes', pp.included_minutes,
    'period_minutes', pp.period_minutes,
    'price_per_period_cents', pp.price_per_period_cents,
    'grace_minutes', pp.grace_minutes,
    'daily_cap_cents', pp.daily_cap_cents,
    'total_cap_cents', pp.total_cap_cents,
    'max_amount_cents', pp.max_amount_cents,
    'deposit_cents', pp.deposit_cents,
    'late_fee_cents', pp.late_fee_cents,
    'unreturned_fee_cents', pp.unreturned_fee_cents,
    'unreturned_after_minutes', pp.unreturned_after_minutes,
    'min_amount_cents', pp.min_amount_cents,
    'rounding', pp.rounding,
    'computed_at', now()
  );
end;
$$;

revoke all on function public.compute_customer_pricing_snapshot(text,text,timestamptz,timestamptz,text,text,text)
  from public, anon, authenticated;
grant execute on function public.compute_customer_pricing_snapshot(text,text,timestamptz,timestamptz,text,text,text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Physical release observation / station quarantine
-- ---------------------------------------------------------------------------
create table if not exists public.hardware_release_attempts (
  id uuid primary key default gen_random_uuid(),
  rental_session_id uuid not null unique references public.rental_sessions(id) on update cascade on delete cascade,
  station_id text not null references public.stations(station_id) on update cascade on delete cascade,
  selected_slot_num integer not null check (selected_slot_num > 0),
  expected_battery_id text,
  pre_snapshot jsonb not null,
  post_snapshot jsonb,
  command_sent_at timestamptz,
  reconciled_at timestamptz,
  result text not null default 'prepared'
    check (result in ('prepared','command_sent','pending','single_release','no_release','unexpected_release','multi_release')),
  released_slot_nums integer[] not null default '{}',
  released_battery_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.hardware_release_attempts enable row level security;
revoke all on table public.hardware_release_attempts from public, anon, authenticated;
grant select, insert, update, delete on table public.hardware_release_attempts to service_role;

create table if not exists public.station_hardware_quarantines (
  station_id text primary key references public.stations(station_id) on update cascade on delete cascade,
  active boolean not null default true,
  reason_code text not null,
  source_rental_session_id uuid references public.rental_sessions(id) on update cascade on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cleared_at timestamptz,
  cleared_by uuid references auth.users(id) on update cascade on delete set null
);

alter table public.station_hardware_quarantines enable row level security;
revoke all on table public.station_hardware_quarantines from public, anon, authenticated;
grant select, insert, update, delete on table public.station_hardware_quarantines to service_role;

create or replace function public.is_station_hardware_quarantined(p_station_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.station_hardware_quarantines q
    where q.station_id = p_station_id and q.active = true
  );
$$;
revoke all on function public.is_station_hardware_quarantined(text) from public, anon, authenticated;
grant execute on function public.is_station_hardware_quarantined(text) to service_role;

-- Historical operator observation from the latest DTA21269 Stripe Test command:
-- Chargeurs.ch logged exactly one /cabinet/ejectByRent request for slot 1, while
-- the operator observed two batteries physically leaving the cabinet. Record
-- the incident as evidence; it is intentionally not auto-resolved.
insert into public.station_hardware_quarantines(
  station_id, active, reason_code, source_rental_session_id, details
)
values (
  'DTA21269', true, 'MULTI_BATTERY_RELEASE_OBSERVED',
  '12c7892d-7bb0-4b0b-9efa-b3e2edd4e6b1'::uuid,
  jsonb_build_object(
    'trade_no', '26081004390299832121',
    'requested_slot_num', 1,
    'backend_eject_call_count', 1,
    'operator_reported_released_battery_count', 2,
    'automatic_retry_allowed', false,
    'source', 'operator_observation'
  )
)
on conflict (station_id) do update
set active = true,
    reason_code = excluded.reason_code,
    source_rental_session_id = excluded.source_rental_session_id,
    details = excluded.details,
    updated_at = now(),
    cleared_at = null,
    cleared_by = null;

insert into public.system_incidents(
  type, severity, message, data, resolved, rental_session_id, station_id
)
select
  'multi_battery_release',
  'critical',
  'Une seule commande ChargeNow a été journalisée mais deux batteries ont été observées comme sorties physiquement.',
  jsonb_build_object(
    'trade_no', '26081004390299832121',
    'requested_slot_num', 1,
    'backend_eject_call_count', 1,
    'operator_reported_released_battery_count', 2,
    'automatic_retry_allowed', false,
    'hardware_quarantine', true
  ),
  false,
  '12c7892d-7bb0-4b0b-9efa-b3e2edd4e6b1'::uuid,
  'DTA21269'
where not exists (
  select 1 from public.system_incidents
  where type = 'multi_battery_release'
    and station_id = 'DTA21269'
    and resolved = false
);
