-- Client Chargeurs monetization foundation
-- Launch offer: CHF 49/year, CHF 10 renewal credit, CHF 0.75/hour, CHF 9/day cap.
create table if not exists public.customer_membership_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  currency text not null default 'CHF',
  annual_fee_cents integer not null check (annual_fee_cents >= 0),
  renewal_credit_cents integer not null default 0 check (renewal_credit_cents >= 0),
  hourly_cents integer not null check (hourly_cents >= 0),
  daily_cap_cents integer not null check (daily_cap_cents >= 0),
  active boolean not null default true,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null references public.customer_membership_plans(id),
  status text not null default 'pending' check (status in ('pending','active','past_due','cancelled','expired')),
  starts_at timestamptz,
  renews_at timestamptz,
  ends_at timestamptz,
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists customer_memberships_one_live_per_user
  on public.customer_memberships(user_id) where status in ('pending','active','past_due');

create table if not exists public.customer_wallet_passes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  membership_id uuid references public.customer_memberships(id) on delete set null,
  public_pass_id text not null unique default encode(gen_random_bytes(18),'hex'),
  apple_serial_number text unique,
  google_object_id text unique,
  status text not null default 'active' check (status in ('active','suspended','revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists customer_wallet_passes_active_user
  on public.customer_wallet_passes(user_id) where status='active';

alter table public.customer_membership_plans enable row level security;
alter table public.customer_memberships enable row level security;
alter table public.customer_wallet_passes enable row level security;

create policy "members read active plans" on public.customer_membership_plans
  for select to authenticated using (active = true);
create policy "users read own memberships" on public.customer_memberships
  for select to authenticated using (auth.uid() = user_id);
create policy "users read own wallet passes" on public.customer_wallet_passes
  for select to authenticated using (auth.uid() = user_id);

insert into public.customer_membership_plans
  (code,name,currency,annual_fee_cents,renewal_credit_cents,hourly_cents,daily_cap_cents,active)
values ('client','Client Chargeurs','CHF',4900,1000,75,900,true)
on conflict (code) do update set
  name=excluded.name,
  currency=excluded.currency,
  annual_fee_cents=excluded.annual_fee_cents,
  renewal_credit_cents=excluded.renewal_credit_cents,
  hourly_cents=excluded.hourly_cents,
  daily_cap_cents=excluded.daily_cap_cents,
  active=true,
  updated_at=now();

-- Existing kiosk member profile becomes the launch Client Chargeurs tariff.
update public.price_profiles p set
  period_minutes=60,
  price_per_period_cents=75,
  daily_cap_cents=900,
  amount=0.75,
  period_label='heure',
  description='Client Chargeurs — adhésion annuelle 49 CHF, 10 CHF de crédit renouvellement, tarif membre 0.75 CHF/h, plafond 9 CHF/jour',
  updated_at=now(),
  version=coalesce(version,0)+1
where p.id in (
  select price_profile_id from public.customer_segment_price_profiles
  where segment='member' and active=true
);