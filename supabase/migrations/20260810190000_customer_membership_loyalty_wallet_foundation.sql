-- Chargeurs.ch customer membership / loyalty / Wallet foundation.
-- Existing annual plan values are preserved. New commercial values remain admin-owned.

alter table public.customer_membership_plans
  add column if not exists billing_interval text not null default 'year',
  add column if not exists billing_interval_count integer not null default 1,
  add column if not exists included_minutes integer,
  add column if not exists discount_percent numeric(5,2),
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.customer_membership_plans
  drop constraint if exists customer_membership_plans_billing_interval_check,
  add constraint customer_membership_plans_billing_interval_check check (billing_interval in ('month','year')),
  drop constraint if exists customer_membership_plans_billing_interval_count_check,
  add constraint customer_membership_plans_billing_interval_count_check check (billing_interval_count > 0 and billing_interval_count <= 24),
  drop constraint if exists customer_membership_plans_included_minutes_check,
  add constraint customer_membership_plans_included_minutes_check check (included_minutes is null or included_minutes >= 0),
  drop constraint if exists customer_membership_plans_discount_percent_check,
  add constraint customer_membership_plans_discount_percent_check check (discount_percent is null or (discount_percent >= 0 and discount_percent <= 100));

create table if not exists public.customer_membership_benefits (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.customer_membership_plans(id) on delete cascade,
  code text not null,
  benefit_type text not null,
  value jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  sort_order integer not null default 0,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_membership_benefits_type_check check (benefit_type in ('credit','discount','included_minutes','partner','promotion','feature','other')),
  constraint customer_membership_benefits_validity_check check (valid_to is null or valid_to > valid_from),
  unique(plan_id, code)
);
create index if not exists customer_membership_benefits_active_idx on public.customer_membership_benefits(plan_id, active, sort_order);
alter table public.customer_membership_benefits enable row level security;
drop policy if exists "members read active membership benefits" on public.customer_membership_benefits;
create policy "members read active membership benefits" on public.customer_membership_benefits for select to authenticated
  using (active = true and valid_from <= now() and (valid_to is null or valid_to >= now()));

create table if not exists public.customer_chargepoints_rules (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  event_type text not null,
  fixed_points integer,
  points_per_chf numeric(12,4),
  active boolean not null default false,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_chargepoints_rules_value_check check (fixed_points is not null or points_per_chf is not null),
  constraint customer_chargepoints_rules_fixed_check check (fixed_points is null or fixed_points >= 0),
  constraint customer_chargepoints_rules_rate_check check (points_per_chf is null or points_per_chf >= 0),
  constraint customer_chargepoints_rules_validity_check check (valid_to is null or valid_to > valid_from)
);
alter table public.customer_chargepoints_rules enable row level security;
drop policy if exists "members read active chargepoints rules" on public.customer_chargepoints_rules;
create policy "members read active chargepoints rules" on public.customer_chargepoints_rules for select to authenticated
  using (active = true and valid_from <= now() and (valid_to is null or valid_to >= now()));

create table if not exists public.customer_chargepoints_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  delta integer not null,
  reason text not null,
  source_type text not null,
  source_id text,
  idempotency_key text not null unique,
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint customer_chargepoints_ledger_delta_check check (delta <> 0),
  constraint customer_chargepoints_ledger_source_check check (source_type in ('rental','membership','renewal','partner','promotion','adjustment','expiration','other'))
);
create index if not exists customer_chargepoints_ledger_user_created_idx on public.customer_chargepoints_ledger(user_id, created_at desc);
create index if not exists customer_chargepoints_ledger_user_expiry_idx on public.customer_chargepoints_ledger(user_id, expires_at) where expires_at is not null;
alter table public.customer_chargepoints_ledger enable row level security;
drop policy if exists "users read own chargepoints" on public.customer_chargepoints_ledger;
create policy "users read own chargepoints" on public.customer_chargepoints_ledger for select to authenticated using (auth.uid() = user_id);

create or replace function public.prevent_chargepoints_ledger_mutation()
returns trigger language plpgsql security definer set search_path = public as $function$
begin
  raise exception using errcode = '55000', message = 'CHARGEPOINTS_LEDGER_IMMUTABLE';
end;
$function$;
drop trigger if exists trg_chargepoints_ledger_immutable_update on public.customer_chargepoints_ledger;
create trigger trg_chargepoints_ledger_immutable_update before update or delete on public.customer_chargepoints_ledger
for each row execute function public.prevent_chargepoints_ledger_mutation();

create or replace function public.append_customer_chargepoints(
  p_user_id uuid,
  p_delta integer,
  p_reason text,
  p_source_type text,
  p_source_id text,
  p_idempotency_key text,
  p_expires_at timestamptz default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.customer_chargepoints_ledger
language plpgsql security definer set search_path = public as $function$
declare
  v_row public.customer_chargepoints_ledger;
begin
  if p_user_id is null or p_delta = 0 or coalesce(trim(p_reason),'') = ''
     or coalesce(trim(p_source_type),'') = '' or coalesce(trim(p_idempotency_key),'') = '' then
    raise exception using errcode = '22023', message = 'INVALID_CHARGEPOINTS_EVENT';
  end if;
  insert into public.customer_chargepoints_ledger(
    user_id, delta, reason, source_type, source_id, idempotency_key, expires_at, metadata
  ) values (
    p_user_id, p_delta, trim(p_reason), trim(p_source_type), nullif(trim(p_source_id),''),
    trim(p_idempotency_key), p_expires_at, coalesce(p_metadata,'{}'::jsonb)
  )
  on conflict (idempotency_key) do nothing
  returning * into v_row;
  if v_row.id is null then
    select * into v_row from public.customer_chargepoints_ledger where idempotency_key = trim(p_idempotency_key);
  end if;
  return v_row;
end;
$function$;
revoke all on function public.append_customer_chargepoints(uuid,integer,text,text,text,text,timestamptz,jsonb) from public, anon, authenticated;
grant execute on function public.append_customer_chargepoints(uuid,integer,text,text,text,text,timestamptz,jsonb) to service_role;

create or replace view public.customer_chargepoints_balances with (security_invoker = true) as
select user_id,
       coalesce(sum(delta) filter (where expires_at is null or expires_at > now()),0)::bigint as balance,
       max(created_at) as last_activity_at
from public.customer_chargepoints_ledger
group by user_id;
grant select on public.customer_chargepoints_balances to authenticated;

alter table public.customer_wallet_passes
  add column if not exists token_version integer not null default 1,
  add column if not exists access_token_hash text,
  add column if not exists pass_revision integer not null default 1,
  add column if not exists provider_status text not null default 'not_issued',
  add column if not exists last_generated_at timestamptz,
  add column if not exists last_synced_at timestamptz,
  add column if not exists revoked_at timestamptz,
  add column if not exists provider_metadata jsonb not null default '{}'::jsonb;
alter table public.customer_wallet_passes
  drop constraint if exists customer_wallet_passes_token_version_check,
  add constraint customer_wallet_passes_token_version_check check (token_version > 0),
  drop constraint if exists customer_wallet_passes_pass_revision_check,
  add constraint customer_wallet_passes_pass_revision_check check (pass_revision > 0),
  drop constraint if exists customer_wallet_passes_provider_status_check,
  add constraint customer_wallet_passes_provider_status_check check (provider_status in ('not_issued','pending','issued','update_pending','error','revoked'));
create unique index if not exists customer_wallet_passes_access_token_hash_uidx on public.customer_wallet_passes(access_token_hash) where access_token_hash is not null;
create index if not exists customer_memberships_user_status_idx on public.customer_memberships(user_id, status, ends_at);
create index if not exists customer_wallet_passes_user_status_idx on public.customer_wallet_passes(user_id, status);

-- No earning rule is inserted here intentionally: ChargePoints economics remain
-- unconfigured until an operator explicitly validates a commercial rule.
