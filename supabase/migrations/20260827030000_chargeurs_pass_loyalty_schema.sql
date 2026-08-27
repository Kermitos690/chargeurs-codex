-- Chargeurs Pass loyalty schema and wallet hardening.
-- Additive/non-destructive. Customers may read their financial data but never
-- mutate real-money balances or ledgers directly.

revoke insert, update, delete, truncate, references, trigger on public.wallets from authenticated;
revoke insert, update, delete, truncate, references, trigger on public.wallet_topups from authenticated;
revoke insert, update, delete, truncate, references, trigger on public.wallet_ledger from authenticated;
grant select on public.wallets, public.wallet_topups, public.wallet_ledger to authenticated;

alter table public.wallet_ledger
  add column if not exists credit_kind text not null default 'other',
  add column if not exists source_type text,
  add column if not exists source_id text,
  add column if not exists campaign_id uuid,
  add column if not exists reward_id uuid,
  add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.wallet_ledger drop constraint if exists wallet_ledger_credit_kind_check;
alter table public.wallet_ledger add constraint wallet_ledger_credit_kind_check
  check (credit_kind in ('paid','promo','refund','reservation','other'));

alter table public.wallet_topups
  add column if not exists campaign_id uuid,
  add column if not exists payment_purpose text,
  add column if not exists stripe_payment_intent_id text,
  add column if not exists confirmed_at timestamptz,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists public.loyalty_campaigns (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  currency text not null default 'CHF',
  purchase_price_cents integer not null default 0 check (purchase_price_cents >= 0),
  purchased_credit_cents integer not null default 0 check (purchased_credit_cents >= 0),
  reward_value_cap_cents integer not null default 0 check (reward_value_cap_cents >= 0),
  max_enrollments_per_user integer not null default 1 check (max_enrollments_per_user > 0),
  active boolean not null default false,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_to is null or valid_to > valid_from)
);

create table if not exists public.loyalty_campaign_enrollments (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.loyalty_campaigns(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  wallet_topup_id uuid references public.wallet_topups(id),
  status text not null default 'pending' check (status in ('pending','active','completed','cancelled')),
  paid_amount_cents integer not null default 0 check (paid_amount_cents >= 0),
  purchased_credit_cents integer not null default 0 check (purchased_credit_cents >= 0),
  campaign_points_earned bigint not null default 0 check (campaign_points_earned >= 0),
  campaign_points_spent bigint not null default 0 check (campaign_points_spent >= 0),
  reward_value_unlocked_cents integer not null default 0 check (reward_value_unlocked_cents >= 0),
  reward_value_redeemed_cents integer not null default 0 check (reward_value_redeemed_cents >= 0),
  enrolled_at timestamptz not null default now(),
  activated_at timestamptz,
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  unique (campaign_id, user_id)
);

create table if not exists public.loyalty_missions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.loyalty_campaigns(id) on delete cascade,
  code text not null,
  name text not null,
  description text,
  metric text not null check (metric in ('completed_rentals','distinct_stations','spent_cents')),
  threshold bigint not null check (threshold > 0),
  reward_points bigint not null check (reward_points > 0),
  reward_value_cents integer not null default 0 check (reward_value_cents >= 0),
  max_completions_per_user integer not null default 1 check (max_completions_per_user > 0),
  active boolean not null default true,
  sort_order integer not null default 0,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, code)
);

create table if not exists public.loyalty_mission_progress (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.loyalty_campaign_enrollments(id) on delete cascade,
  mission_id uuid not null references public.loyalty_missions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  progress bigint not null default 0 check (progress >= 0),
  status text not null default 'in_progress' check (status in ('in_progress','completed')),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (enrollment_id, mission_id)
);

create table if not exists public.rewards_catalog (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.loyalty_campaigns(id) on delete cascade,
  code text not null unique,
  name text not null,
  description text,
  reward_type text not null check (reward_type in ('wallet_credit','rental_day','partner','physical','custom')),
  points_cost bigint not null check (points_cost > 0),
  reward_value_cents integer not null default 0 check (reward_value_cents >= 0),
  wallet_credit_cents integer not null default 0 check (wallet_credit_cents >= 0),
  active boolean not null default true,
  max_redemptions_per_user integer,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_to is null or valid_to > valid_from),
  check (reward_type <> 'wallet_credit' or wallet_credit_cents > 0)
);

create table if not exists public.reward_redemptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reward_id uuid not null references public.rewards_catalog(id),
  campaign_id uuid references public.loyalty_campaigns(id),
  enrollment_id uuid references public.loyalty_campaign_enrollments(id),
  points_spent bigint not null check (points_spent > 0),
  reward_value_cents integer not null default 0 check (reward_value_cents >= 0),
  status text not null default 'completed' check (status in ('completed','reversed','failed')),
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.wallet_rental_reservations (
  rental_session_id uuid primary key references public.rental_sessions(id) on delete cascade,
  wallet_id uuid not null references public.wallets(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  currency text not null default 'CHF',
  held_cents integer not null check (held_cents > 0),
  final_cents integer check (final_cents is null or final_cents >= 0),
  status text not null default 'reserved' check (status in ('reserved','settled','released')),
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  released_at timestamptz
);

create unique index if not exists wallet_topups_one_open_campaign_purchase
  on public.wallet_topups(wallet_id, campaign_id)
  where campaign_id is not null and status in ('pending','completed');
create index if not exists loyalty_enrollments_user_idx on public.loyalty_campaign_enrollments(user_id,status);
create index if not exists loyalty_progress_user_idx on public.loyalty_mission_progress(user_id,status);
create index if not exists reward_redemptions_user_idx on public.reward_redemptions(user_id,created_at desc);
create index if not exists wallet_reservations_user_idx on public.wallet_rental_reservations(user_id,status);

alter table public.loyalty_campaigns enable row level security;
alter table public.loyalty_campaign_enrollments enable row level security;
alter table public.loyalty_missions enable row level security;
alter table public.loyalty_mission_progress enable row level security;
alter table public.rewards_catalog enable row level security;
alter table public.reward_redemptions enable row level security;
alter table public.wallet_rental_reservations enable row level security;

revoke all on public.loyalty_campaigns,public.loyalty_campaign_enrollments,public.loyalty_missions,
  public.loyalty_mission_progress,public.rewards_catalog,public.reward_redemptions,public.wallet_rental_reservations
  from public,anon,authenticated;
grant select on public.loyalty_campaigns,public.loyalty_campaign_enrollments,public.loyalty_missions,
  public.loyalty_mission_progress,public.rewards_catalog,public.reward_redemptions,public.wallet_rental_reservations
  to authenticated;
grant all on public.loyalty_campaigns,public.loyalty_campaign_enrollments,public.loyalty_missions,
  public.loyalty_mission_progress,public.rewards_catalog,public.reward_redemptions,public.wallet_rental_reservations
  to service_role;

create policy loyalty_campaigns_read_active on public.loyalty_campaigns for select to authenticated
  using (active and valid_from<=now() and (valid_to is null or valid_to>now()));
create policy loyalty_enrollments_read_own on public.loyalty_campaign_enrollments for select to authenticated using (user_id=auth.uid());
create policy loyalty_missions_read_active on public.loyalty_missions for select to authenticated using (active);
create policy loyalty_progress_read_own on public.loyalty_mission_progress for select to authenticated using (user_id=auth.uid());
create policy rewards_catalog_read_active on public.rewards_catalog for select to authenticated
  using (active and valid_from<=now() and (valid_to is null or valid_to>now()));
create policy reward_redemptions_read_own on public.reward_redemptions for select to authenticated using (user_id=auth.uid());
create policy wallet_reservations_read_own on public.wallet_rental_reservations for select to authenticated using (user_id=auth.uid());
