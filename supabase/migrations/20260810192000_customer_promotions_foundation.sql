create table if not exists public.customer_promotions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  partner_id uuid references public.partners(id) on delete set null,
  plan_id uuid references public.customer_membership_plans(id) on delete set null,
  audience text not null default 'all',
  promotion_type text not null,
  rules jsonb not null default '{}'::jsonb,
  content jsonb not null default '{}'::jsonb,
  active boolean not null default false,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  max_redemptions integer,
  max_redemptions_per_user integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_promotions_audience_check check (audience in ('all','guest','member')),
  constraint customer_promotions_type_check check (promotion_type in ('discount','credit','chargepoints','partner_benefit','campaign','other')),
  constraint customer_promotions_validity_check check (valid_to is null or valid_to > valid_from),
  constraint customer_promotions_max_check check (max_redemptions is null or max_redemptions > 0),
  constraint customer_promotions_user_max_check check (max_redemptions_per_user is null or max_redemptions_per_user > 0)
);
create index if not exists customer_promotions_active_idx on public.customer_promotions(active,audience,valid_from,valid_to);
create index if not exists customer_promotions_partner_idx on public.customer_promotions(partner_id) where partner_id is not null;
create index if not exists customer_promotions_plan_idx on public.customer_promotions(plan_id) where plan_id is not null;
alter table public.customer_promotions enable row level security;
drop policy if exists "customers read active promotions" on public.customer_promotions;
create policy "customers read active promotions" on public.customer_promotions for select to authenticated
  using (active=true and valid_from<=now() and (valid_to is null or valid_to>=now()));

create table if not exists public.customer_promotion_redemptions (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references public.customer_promotions(id) on delete restrict,
  user_id uuid references auth.users(id) on delete set null,
  rental_session_id uuid references public.rental_sessions(id) on delete set null,
  idempotency_key text not null unique,
  benefit_snapshot jsonb not null default '{}'::jsonb,
  redeemed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists customer_promotion_redemptions_user_idx on public.customer_promotion_redemptions(user_id,redeemed_at desc);
create index if not exists customer_promotion_redemptions_promotion_idx on public.customer_promotion_redemptions(promotion_id,redeemed_at desc);
alter table public.customer_promotion_redemptions enable row level security;
drop policy if exists "users read own promotion redemptions" on public.customer_promotion_redemptions;
create policy "users read own promotion redemptions" on public.customer_promotion_redemptions for select to authenticated using (auth.uid()=user_id);

create or replace function public.prevent_promotion_redemption_mutation()
returns trigger language plpgsql security definer set search_path=public as $function$
begin
  raise exception using errcode='55000',message='PROMOTION_REDEMPTION_IMMUTABLE';
end;
$function$;
drop trigger if exists trg_promotion_redemptions_immutable on public.customer_promotion_redemptions;
create trigger trg_promotion_redemptions_immutable before update or delete on public.customer_promotion_redemptions
for each row execute function public.prevent_promotion_redemption_mutation();

-- No commercial value is inserted here. Operators explicitly configure and activate rules.
