-- Chargeurs Pass loyalty v1
-- Additive, non-destructive migration for the central customer Pass.
-- Existing rental pricing snapshots remain immutable. Express pricing is untouched.

-- ---------------------------------------------------------------------------
-- 1. Harden the real-money wallet: customers may read, never mutate directly.
-- ---------------------------------------------------------------------------
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

create unique index if not exists wallet_topups_one_open_campaign_purchase
  on public.wallet_topups(wallet_id, campaign_id)
  where campaign_id is not null and status in ('pending','completed');

-- ---------------------------------------------------------------------------
-- 2. Generic campaigns, missions and rewards.
-- ---------------------------------------------------------------------------
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

create index if not exists loyalty_enrollments_user_idx on public.loyalty_campaign_enrollments(user_id, status);
create index if not exists loyalty_progress_user_idx on public.loyalty_mission_progress(user_id, status);
create index if not exists reward_redemptions_user_idx on public.reward_redemptions(user_id, created_at desc);
create index if not exists wallet_reservations_user_idx on public.wallet_rental_reservations(user_id, status);

alter table public.loyalty_campaigns enable row level security;
alter table public.loyalty_campaign_enrollments enable row level security;
alter table public.loyalty_missions enable row level security;
alter table public.loyalty_mission_progress enable row level security;
alter table public.rewards_catalog enable row level security;
alter table public.reward_redemptions enable row level security;
alter table public.wallet_rental_reservations enable row level security;

revoke all on public.loyalty_campaigns, public.loyalty_campaign_enrollments, public.loyalty_missions,
  public.loyalty_mission_progress, public.rewards_catalog, public.reward_redemptions,
  public.wallet_rental_reservations from public, anon, authenticated;
grant select on public.loyalty_campaigns, public.loyalty_missions, public.rewards_catalog to authenticated;
grant select on public.loyalty_campaign_enrollments, public.loyalty_mission_progress, public.reward_redemptions,
  public.wallet_rental_reservations to authenticated;
grant all on public.loyalty_campaigns, public.loyalty_campaign_enrollments, public.loyalty_missions,
  public.loyalty_mission_progress, public.rewards_catalog, public.reward_redemptions,
  public.wallet_rental_reservations to service_role;

create policy loyalty_campaigns_read_active on public.loyalty_campaigns for select to authenticated
  using (active and valid_from <= now() and (valid_to is null or valid_to > now()));
create policy loyalty_missions_read_active on public.loyalty_missions for select to authenticated
  using (active);
create policy rewards_catalog_read_active on public.rewards_catalog for select to authenticated
  using (active and valid_from <= now() and (valid_to is null or valid_to > now()));
create policy loyalty_enrollments_read_own on public.loyalty_campaign_enrollments for select to authenticated
  using (user_id = auth.uid());
create policy loyalty_progress_read_own on public.loyalty_mission_progress for select to authenticated
  using (user_id = auth.uid());
create policy reward_redemptions_read_own on public.reward_redemptions for select to authenticated
  using (user_id = auth.uid());
create policy wallet_reservations_read_own on public.wallet_rental_reservations for select to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 3. Server-only immutable wallet append primitive.
-- ---------------------------------------------------------------------------
create or replace function public.append_wallet_entry_server(
  p_user_id uuid,
  p_amount_cents integer,
  p_type text,
  p_idempotency_key text,
  p_credit_kind text default 'other',
  p_source_type text default null,
  p_source_id text default null,
  p_campaign_id uuid default null,
  p_reward_id uuid default null,
  p_ref_rental_session_id uuid default null,
  p_ref_stripe_id text default null,
  p_note text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table(entry_id uuid, wallet_id uuid, balance_after_cents integer, applied boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_wallet public.wallets%rowtype;
  v_entry public.wallet_ledger%rowtype;
begin
  if p_user_id is null or p_amount_cents = 0 or coalesce(trim(p_idempotency_key),'') = '' then
    raise exception 'WALLET_ENTRY_INVALID';
  end if;
  if p_type not in ('credit','debit','hold','release','refund','adjust','bonus','topup') then
    raise exception 'WALLET_ENTRY_TYPE_INVALID';
  end if;

  insert into public.wallets(user_id, currency)
  values (p_user_id, 'CHF')
  on conflict (user_id, currency) do nothing;

  select * into v_wallet from public.wallets
  where user_id = p_user_id and currency = 'CHF'
  for update;
  if not found then raise exception 'WALLET_NOT_FOUND'; end if;

  select * into v_entry from public.wallet_ledger where idempotency_key = p_idempotency_key;
  if found then
    if v_entry.wallet_id <> v_wallet.id or v_entry.amount_cents <> p_amount_cents then
      raise exception 'WALLET_IDEMPOTENCY_CONFLICT';
    end if;
    return query select v_entry.id, v_wallet.id, coalesce(v_entry.balance_after_cents,0), false;
    return;
  end if;

  insert into public.wallet_ledger(
    wallet_id, type, amount_cents, currency, ref_rental_session_id, ref_stripe_id,
    idempotency_key, note, credit_kind, source_type, source_id, campaign_id, reward_id, metadata
  ) values (
    v_wallet.id, p_type, p_amount_cents, 'CHF', p_ref_rental_session_id, p_ref_stripe_id,
    p_idempotency_key, p_note, p_credit_kind, p_source_type, p_source_id, p_campaign_id, p_reward_id,
    coalesce(p_metadata,'{}'::jsonb)
  ) returning * into v_entry;

  return query select v_entry.id, v_wallet.id, coalesce(v_entry.balance_after_cents,0), true;
end;
$function$;
revoke all on function public.append_wallet_entry_server(uuid,integer,text,text,text,text,text,uuid,uuid,uuid,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.append_wallet_entry_server(uuid,integer,text,text,text,text,text,uuid,uuid,uuid,text,text,jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Launch offer confirmation: signed Stripe webhook calls this exactly once.
-- ---------------------------------------------------------------------------
create or replace function public.confirm_chargeurs_pass_topup(
  p_topup_id uuid,
  p_stripe_checkout_session_id text,
  p_stripe_payment_intent_id text,
  p_amount_cents integer,
  p_currency text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_topup public.wallet_topups%rowtype;
  v_wallet public.wallets%rowtype;
  v_campaign public.loyalty_campaigns%rowtype;
  v_entry record;
  v_enrollment_id uuid;
begin
  select * into v_topup from public.wallet_topups where id = p_topup_id for update;
  if not found then raise exception 'PASS_TOPUP_NOT_FOUND'; end if;
  select * into v_wallet from public.wallets where id = v_topup.wallet_id for update;
  if not found then raise exception 'PASS_WALLET_NOT_FOUND'; end if;
  select * into v_campaign from public.loyalty_campaigns where id = v_topup.campaign_id for update;
  if not found or v_campaign.code <> 'launch_offer_45' then raise exception 'PASS_CAMPAIGN_INVALID'; end if;

  if upper(coalesce(p_currency,'')) <> upper(v_campaign.currency)
     or p_amount_cents <> v_campaign.purchase_price_cents
     or v_topup.amount_cents <> v_campaign.purchase_price_cents
     or upper(v_topup.currency) <> upper(v_campaign.currency) then
    raise exception 'PASS_TOPUP_AMOUNT_MISMATCH';
  end if;
  if v_topup.stripe_checkout_session_id is distinct from p_stripe_checkout_session_id then
    raise exception 'PASS_TOPUP_CHECKOUT_MISMATCH';
  end if;

  select * into v_entry from public.append_wallet_entry_server(
    v_wallet.user_id,
    v_campaign.purchased_credit_cents,
    'topup',
    'pass_topup:' || p_stripe_checkout_session_id,
    'paid',
    'stripe_topup',
    p_topup_id::text,
    v_campaign.id,
    null,
    null,
    p_stripe_payment_intent_id,
    'Chargeurs Pass — crédit acheté',
    jsonb_build_object('checkout_session_id',p_stripe_checkout_session_id,'campaign_code',v_campaign.code)
  );

  update public.wallet_topups
  set status='completed', stripe_payment_intent_id=p_stripe_payment_intent_id,
      confirmed_at=coalesce(confirmed_at,now()), updated_at=now()
  where id=p_topup_id;

  insert into public.loyalty_campaign_enrollments(
    campaign_id,user_id,wallet_topup_id,status,paid_amount_cents,purchased_credit_cents,activated_at
  ) values (
    v_campaign.id,v_wallet.user_id,p_topup_id,'active',p_amount_cents,v_campaign.purchased_credit_cents,now()
  )
  on conflict (campaign_id,user_id) do update set
    wallet_topup_id=excluded.wallet_topup_id,
    status=case when public.loyalty_campaign_enrollments.status='pending' then 'active' else public.loyalty_campaign_enrollments.status end,
    paid_amount_cents=greatest(public.loyalty_campaign_enrollments.paid_amount_cents,excluded.paid_amount_cents),
    purchased_credit_cents=greatest(public.loyalty_campaign_enrollments.purchased_credit_cents,excluded.purchased_credit_cents),
    activated_at=coalesce(public.loyalty_campaign_enrollments.activated_at,now())
  returning id into v_enrollment_id;

  return jsonb_build_object('ok',true,'topup_id',p_topup_id,'enrollment_id',v_enrollment_id,
    'wallet_balance_cents',v_entry.balance_after_cents,'credited_cents',v_campaign.purchased_credit_cents,
    'replayed',not v_entry.applied);
end;
$function$;
revoke all on function public.confirm_chargeurs_pass_topup(uuid,text,text,integer,text) from public, anon, authenticated;
grant execute on function public.confirm_chargeurs_pass_topup(uuid,text,text,integer,text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Atomic reward redemption. Campaign rewards are gated by BOTH points and
--    unlocked promotional value, guaranteeing launch value <= CHF 45.
-- ---------------------------------------------------------------------------
create or replace function public.redeem_chargepoints_reward(
  p_reward_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user uuid := auth.uid();
  v_reward public.rewards_catalog%rowtype;
  v_enrollment public.loyalty_campaign_enrollments%rowtype;
  v_existing public.reward_redemptions%rowtype;
  v_count integer;
  v_points_balance bigint;
  v_points_after bigint;
  v_wallet record;
  v_redemption_id uuid := gen_random_uuid();
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if coalesce(trim(p_idempotency_key),'')='' then raise exception 'REDEMPTION_IDEMPOTENCY_REQUIRED'; end if;

  select * into v_existing from public.reward_redemptions
  where idempotency_key=p_idempotency_key and user_id=v_user;
  if found then return jsonb_build_object('ok',true,'redemption_id',v_existing.id,'replayed',true); end if;

  select * into v_reward from public.rewards_catalog
  where id=p_reward_id and active and valid_from<=now() and (valid_to is null or valid_to>now())
  for update;
  if not found then raise exception 'REWARD_UNAVAILABLE'; end if;

  if v_reward.max_redemptions_per_user is not null then
    select count(*) into v_count from public.reward_redemptions
    where user_id=v_user and reward_id=v_reward.id and status='completed';
    if v_count >= v_reward.max_redemptions_per_user then raise exception 'REWARD_USER_LIMIT_REACHED'; end if;
  end if;

  select coalesce(balance,0) into v_points_balance from public.customer_chargepoints_balances
  where user_id=v_user for update;
  v_points_balance := coalesce(v_points_balance,0);
  if v_points_balance < v_reward.points_cost then raise exception 'INSUFFICIENT_CHARGEPOINTS'; end if;

  if v_reward.campaign_id is not null then
    select * into v_enrollment from public.loyalty_campaign_enrollments
    where campaign_id=v_reward.campaign_id and user_id=v_user and status in ('active','completed')
    for update;
    if not found then raise exception 'CAMPAIGN_ENROLLMENT_REQUIRED'; end if;
    if v_enrollment.campaign_points_earned - v_enrollment.campaign_points_spent < v_reward.points_cost then
      raise exception 'INSUFFICIENT_CAMPAIGN_POINTS';
    end if;
    if v_enrollment.reward_value_redeemed_cents + v_reward.reward_value_cents > v_enrollment.reward_value_unlocked_cents then
      raise exception 'REWARD_VALUE_NOT_YET_UNLOCKED';
    end if;
    if v_enrollment.reward_value_redeemed_cents + v_reward.reward_value_cents >
       (select reward_value_cap_cents from public.loyalty_campaigns where id=v_reward.campaign_id) then
      raise exception 'CAMPAIGN_REWARD_VALUE_CAP';
    end if;
  end if;

  v_points_after := public.append_customer_chargepoints(
    v_user,-v_reward.points_cost,'redeem','reward_redeemed','reward',v_reward.id,null,
    p_idempotency_key || ':points',
    jsonb_build_object('reward_code',v_reward.code,'reward_value_cents',v_reward.reward_value_cents)
  );

  if v_reward.reward_type='wallet_credit' then
    select * into v_wallet from public.append_wallet_entry_server(
      v_user,v_reward.wallet_credit_cents,'bonus',p_idempotency_key || ':wallet','promo',
      'reward',v_reward.id::text,v_reward.campaign_id,v_reward.id,null,null,
      'Récompense Charge Points',jsonb_build_object('reward_code',v_reward.code)
    );
  end if;

  insert into public.reward_redemptions(id,user_id,reward_id,campaign_id,enrollment_id,points_spent,reward_value_cents,status,idempotency_key)
  values (v_redemption_id,v_user,v_reward.id,v_reward.campaign_id,
    case when v_reward.campaign_id is null then null else v_enrollment.id end,
    v_reward.points_cost,v_reward.reward_value_cents,'completed',p_idempotency_key);

  if v_reward.campaign_id is not null then
    update public.loyalty_campaign_enrollments
    set campaign_points_spent=campaign_points_spent+v_reward.points_cost,
        reward_value_redeemed_cents=reward_value_redeemed_cents+v_reward.reward_value_cents
    where id=v_enrollment.id;
  end if;

  return jsonb_build_object('ok',true,'redemption_id',v_redemption_id,'points_balance',v_points_after,
    'wallet_balance_cents',case when v_reward.reward_type='wallet_credit' then v_wallet.balance_after_cents else null end,
    'replayed',false);
end;
$function$;
revoke all on function public.redeem_chargepoints_reward(uuid,text) from public, anon;
grant execute on function public.redeem_chargepoints_reward(uuid,text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Mission engine driven only by trusted rental_completed events.
-- ---------------------------------------------------------------------------
create or replace function public.apply_loyalty_missions_on_rental_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_session public.rental_sessions%rowtype;
  v_enrollment public.loyalty_campaign_enrollments%rowtype;
  v_campaign public.loyalty_campaigns%rowtype;
  v_mission public.loyalty_missions%rowtype;
  v_progress bigint;
  v_existing public.loyalty_mission_progress%rowtype;
  v_points_after bigint;
begin
  if new.event_type <> 'rental_completed' then return new; end if;
  select * into v_session from public.rental_sessions where id=new.rental_id;
  if not found or v_session.customer_user_id is null then return new; end if;
  if coalesce(v_session.final_amount_cents,0) < 0 then return new; end if;

  for v_enrollment in
    select * from public.loyalty_campaign_enrollments
    where user_id=v_session.customer_user_id and status='active'
    for update
  loop
    select * into v_campaign from public.loyalty_campaigns
    where id=v_enrollment.campaign_id and active and valid_from<=now() and (valid_to is null or valid_to>now());
    if not found then continue; end if;

    for v_mission in select * from public.loyalty_missions
      where campaign_id=v_campaign.id and active order by sort_order,id
    loop
      if v_mission.metric='completed_rentals' then
        select count(distinct e.rental_id)::bigint into v_progress
        from public.rental_orchestrator_events e join public.rental_sessions r on r.id=e.rental_id
        where e.event_type='rental_completed' and r.customer_user_id=v_session.customer_user_id;
      elsif v_mission.metric='distinct_stations' then
        select count(distinct r.station_id)::bigint into v_progress
        from public.rental_orchestrator_events e join public.rental_sessions r on r.id=e.rental_id
        where e.event_type='rental_completed' and r.customer_user_id=v_session.customer_user_id;
      else
        select coalesce(sum(greatest(coalesce(r.final_amount_cents,0),0)),0)::bigint into v_progress
        from public.rental_sessions r where r.customer_user_id=v_session.customer_user_id
          and r.state in ('completed','closed','battery_returned');
      end if;

      select * into v_existing from public.loyalty_mission_progress
      where enrollment_id=v_enrollment.id and mission_id=v_mission.id for update;

      if found and v_existing.status='completed' then
        update public.loyalty_mission_progress set progress=greatest(progress,v_progress),updated_at=now()
        where id=v_existing.id;
        continue;
      end if;

      insert into public.loyalty_mission_progress(enrollment_id,mission_id,user_id,progress,status,completed_at)
      values (v_enrollment.id,v_mission.id,v_session.customer_user_id,v_progress,
        case when v_progress>=v_mission.threshold then 'completed' else 'in_progress' end,
        case when v_progress>=v_mission.threshold then now() else null end)
      on conflict (enrollment_id,mission_id) do update set
        progress=greatest(public.loyalty_mission_progress.progress,excluded.progress),
        status=case when excluded.progress>=v_mission.threshold then 'completed' else public.loyalty_mission_progress.status end,
        completed_at=case when excluded.progress>=v_mission.threshold then coalesce(public.loyalty_mission_progress.completed_at,now()) else public.loyalty_mission_progress.completed_at end,
        updated_at=now();

      if v_progress>=v_mission.threshold then
        if v_enrollment.reward_value_unlocked_cents + v_mission.reward_value_cents > v_campaign.reward_value_cap_cents then
          raise exception 'CAMPAIGN_UNLOCK_CAP_EXCEEDED';
        end if;
        v_points_after := public.append_customer_chargepoints(
          v_session.customer_user_id,v_mission.reward_points,'earn','mission_completed','mission',v_mission.id,
          new.rental_id,'loyalty_mission:'||v_enrollment.id::text||':'||v_mission.id::text,
          jsonb_build_object('campaign_code',v_campaign.code,'mission_code',v_mission.code,'event_id',new.id)
        );
        if not exists (
          select 1 from public.customer_chargepoints_ledger
          where user_id=v_session.customer_user_id
            and idempotency_key='loyalty_mission:'||v_enrollment.id::text||':'||v_mission.id::text
            and created_at < now() - interval '1 second'
        ) then
          update public.loyalty_campaign_enrollments set
            campaign_points_earned=campaign_points_earned+v_mission.reward_points,
            reward_value_unlocked_cents=reward_value_unlocked_cents+v_mission.reward_value_cents,
            completed_at=case when reward_value_unlocked_cents+v_mission.reward_value_cents>=v_campaign.reward_value_cap_cents then now() else completed_at end,
            status=case when reward_value_unlocked_cents+v_mission.reward_value_cents>=v_campaign.reward_value_cap_cents then 'completed' else status end
          where id=v_enrollment.id;
          select * into v_enrollment from public.loyalty_campaign_enrollments where id=v_enrollment.id for update;
        end if;
      end if;
    end loop;
  end loop;
  return new;
end;
$function$;

drop trigger if exists chargeurs-apply-loyalty-missions on public.rental_orchestrator_events;
create trigger "chargeurs-apply-loyalty-missions"
after insert on public.rental_orchestrator_events
for each row execute function public.apply_loyalty_missions_on_rental_event();

-- ---------------------------------------------------------------------------
-- 7. Pass pricing: supersede the temporary member tariff for NEW snapshots.
-- CHF 0.50 / started 30 minutes, minimum CHF 2.00 per rental.
-- No daily cap is imposed by this policy; the existing CHF 30 material-liability
-- ceiling and 72h non-return target remain separate.
-- ---------------------------------------------------------------------------
update public.price_profiles
set initial_fee_cents=0,
    included_minutes=0,
    period_minutes=30,
    price_per_period_cents=50,
    grace_minutes=0,
    daily_cap_cents=0,
    min_amount_cents=200,
    deposit_cents=3000,
    unreturned_fee_cents=3000,
    unreturned_after_minutes=4320,
    total_cap_cents=3000,
    max_amount_cents=3000,
    late_fee_cents=0,
    rounding='none',
    tax_percent=0,
    updated_at=now()
where name='Chargeurs.ch Client' and active=true;

-- ---------------------------------------------------------------------------
-- 8. Replace the temporary membership-credit prepaid rail with the real wallet.
-- Existing function name is retained so kiosk/hardware guards remain unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.authorize_member_prepaid_rental(
  p_rental_id uuid,
  p_kiosk_device_id uuid,
  p_correlation_id uuid default null
)
returns table(authorized boolean,reason text,reserved_cents bigint,currency text)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_session public.rental_sessions%rowtype;
  v_snapshot jsonb;
  v_orch public.rental_orchestrator_snapshots%rowtype;
  v_hold record;
  v_res public.wallet_rental_reservations%rowtype;
  v_rail text;
  v_now timestamptz:=now();
  v_required constant integer:=3000;
  v_terms constant text:='terms-2026-08-26-preproduction-v2';
  v_privacy constant text:='privacy-2026-08-26-preproduction-v2';
begin
  select * into v_session from public.rental_sessions where id=p_rental_id for update;
  if not found then raise exception 'RENTAL_NOT_FOUND'; end if;
  if v_session.kiosk_device_id is distinct from p_kiosk_device_id then raise exception 'KIOSK_DEVICE_MISMATCH'; end if;
  if v_session.customer_segment<>'member' or v_session.customer_user_id is null then
    return query select false,'NOT_MEMBER'::text,0::bigint,'CHF'::text; return;
  end if;
  if v_session.contract_terms_version is distinct from v_terms or v_session.contract_privacy_version is distinct from v_privacy or v_session.contract_accepted_at is null then
    raise exception 'CONTRACT_ACCEPTANCE_REQUIRED';
  end if;
  v_snapshot:=v_session.pricing_snapshot;
  if v_snapshot is null or coalesce((v_snapshot->>'pricing_rules_version')::integer,0)<>3
     or coalesce(v_snapshot->>'customer_segment','')<>'member'
     or upper(coalesce(v_snapshot->>'currency',''))<>'CHF'
     or coalesce((v_snapshot->>'deposit_cents')::integer,0)<>v_required
     or coalesce((v_snapshot->>'max_amount_cents')::integer,0)<>v_required then
    raise exception 'MEMBER_PASS_SNAPSHOT_REQUIRED';
  end if;

  select * into v_res from public.wallet_rental_reservations where rental_session_id=p_rental_id for update;
  if found and v_res.status='reserved' and v_session.settlement_strategy='membership_prepaid' and v_session.settlement_status='prepaid' then
    return query select true,'ALREADY_AUTHORIZED'::text,v_res.held_cents::bigint,'CHF'::text; return;
  end if;
  if v_session.paid_at is not null or v_session.stripe_checkout_session_id is not null or v_session.stripe_payment_intent_id is not null then
    raise exception 'PAYMENT_ALREADY_STARTED';
  end if;

  v_rail:=public.claim_rental_payment_rail(p_rental_id,'membership_prepaid',p_correlation_id,
    jsonb_build_object('source','chargeurs_wallet','required_cents',v_required));
  if v_rail<>'PREPAID' then raise exception 'MEMBER_PREPAID_RAIL_CLAIM_FAILED'; end if;

  begin
    select * into v_hold from public.append_wallet_entry_server(
      v_session.customer_user_id,-v_required,'hold','rental_hold:'||p_rental_id::text,'reservation',
      'rental_hold',p_rental_id::text,null,null,p_rental_id,null,'Garantie interne de location',
      jsonb_build_object('correlation_id',p_correlation_id)
    );
  exception when others then
    perform public.release_rental_payment_rail_claim(p_rental_id,'membership_prepaid','insufficient_wallet_balance');
    return query select false,'INSUFFICIENT_PREPAID_BALANCE'::text,0::bigint,'CHF'::text; return;
  end;

  insert into public.wallet_rental_reservations(rental_session_id,wallet_id,user_id,held_cents)
  values (p_rental_id,v_hold.wallet_id,v_session.customer_user_id,v_required)
  on conflict (rental_session_id) do nothing;

  select * into v_orch from public.rental_orchestrator_snapshots where rental_id=p_rental_id for update;
  if v_orch.state='created' then
    select * into v_orch from public.append_rental_orchestrator_event(
      p_rental_id,v_orch.version,'payment_started','payment_started:chargeurs_wallet:'||p_rental_id::text,v_now,
      jsonb_build_object('source','chargeurs_wallet','reserved_cents',v_required),'payment_pending',null,
      v_session.station_id,v_session.battery_id,null,null);
  end if;
  if v_orch.state<>'payment_pending' then raise exception 'ORCHESTRATOR_NOT_PAYMENT_PENDING'; end if;
  select * into v_orch from public.append_rental_orchestrator_event(
    p_rental_id,v_orch.version,'payment_authorized','payment_authorized:chargeurs_wallet:'||p_rental_id::text,v_now,
    jsonb_build_object('source','chargeurs_wallet','reserved_cents',v_required,'stripe_side_effect',false),'authorized',null,
    v_session.station_id,v_session.battery_id,null,null);

  update public.rental_sessions set state='payment_succeeded',settlement_strategy='membership_prepaid',settlement_status='prepaid',
    settlement_error=null,paid_at=v_now,amount_paid=0,captured_amount_cents=0,refunded_amount_cents=0,supplemental_amount_cents=0,updated_at=v_now
  where id=p_rental_id;

  insert into public.payments(rental_session_id,provider,amount,currency,payment_method,status,settlement_strategy,amount_authorized_cents,amount_captured_cents,amount_refunded_cents)
  values(p_rental_id,'chargeurs_wallet',0,'CHF','wallet_balance','authorized','membership_prepaid',v_required,0,0)
  on conflict (rental_session_id) where provider='chargeurs_wallet' do update set status='authorized',amount_authorized_cents=v_required;

  return query select true,'AUTHORIZED'::text,v_required::bigint,'CHF'::text;
end;
$function$;
revoke all on function public.authorize_member_prepaid_rental(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.authorize_member_prepaid_rental(uuid,uuid,uuid) to service_role;

create or replace function public.settle_member_prepaid_on_return()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_res public.wallet_rental_reservations%rowtype;
  v_pricing jsonb;
  v_final integer;
  v_orch public.rental_orchestrator_snapshots%rowtype;
  v_now timestamptz:=now();
begin
  if old.returned_at is not null or new.returned_at is null or new.settlement_strategy<>'membership_prepaid' or new.settlement_status<>'prepaid' then return new; end if;
  select * into v_res from public.wallet_rental_reservations where rental_session_id=new.id for update;
  if not found or v_res.status<>'reserved' or v_res.held_cents<>3000 then raise exception 'WALLET_RESERVATION_REQUIRED'; end if;

  v_pricing:=public.customer_wallet_pricing_state(new.pricing_snapshot,coalesce(new.started_at,new.ejected_at,new.created_at),new.returned_at);
  if v_pricing is null then raise exception 'WALLET_PRICING_FAILED'; end if;
  v_final:=coalesce((v_pricing->>'final_cents')::integer,-1);
  if v_final<0 or v_final>v_res.held_cents then raise exception 'WALLET_FINAL_AMOUNT_INVALID'; end if;

  perform public.append_wallet_entry_server(new.customer_user_id,v_res.held_cents,'release','rental_release:'||new.id::text,'reservation','rental_release',new.id::text,null,null,new.id,null,'Libération de la réserve',v_pricing);
  if v_final>0 then
    perform public.append_wallet_entry_server(new.customer_user_id,-v_final,'debit','rental_debit:'||new.id::text,'paid','rental',new.id::text,null,null,new.id,null,'Location Chargeurs.ch',v_pricing);
  end if;
  update public.wallet_rental_reservations set status='settled',final_cents=v_final,settled_at=v_now where rental_session_id=new.id;

  select * into v_orch from public.rental_orchestrator_snapshots where rental_id=new.id for update;
  if v_orch.state<>'return_detected' then raise exception 'ORCHESTRATOR_NOT_RETURN_DETECTED'; end if;
  select * into v_orch from public.append_rental_orchestrator_event(new.id,v_orch.version,'pricing_finalized','pricing_finalized:chargeurs_wallet:'||new.id::text,new.returned_at,
    jsonb_build_object('source','chargeurs_wallet','finalAmountCents',v_final,'pricing',v_pricing),'pricing_finalized',null,new.station_id,new.battery_id,v_final::numeric/100,null);
  select * into v_orch from public.append_rental_orchestrator_event(new.id,v_orch.version,'payment_captured','payment_captured:chargeurs_wallet:'||new.id::text,v_now,
    jsonb_build_object('source','chargeurs_wallet','debited_cents',v_final,'released_cents',v_res.held_cents-v_final,'stripe_side_effect',false),'payment_captured',null,new.station_id,new.battery_id,v_final::numeric/100,null);
  select * into v_orch from public.append_rental_orchestrator_event(new.id,v_orch.version,'rental_completed','rental_completed:chargeurs_wallet:'||new.id::text,v_now,
    jsonb_build_object('source','chargeurs_wallet'),'completed',null,new.station_id,new.battery_id,v_final::numeric/100,null);

  update public.rental_sessions set state='completed',settlement_status='settled',final_amount_cents=v_final,captured_amount_cents=v_final,
    amount_paid=v_final::numeric/100,completed_at=coalesce(completed_at,v_now),closed_at=coalesce(closed_at,v_now),updated_at=v_now where id=new.id;
  update public.payments set status='succeeded',amount=v_final::numeric/100,amount_captured_cents=v_final,amount_refunded_cents=0
    where rental_session_id=new.id and provider='chargeurs_wallet';
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 9. Seed launch campaign, missions and initial configurable reward catalogue.
-- Total mission reward value = CHF 45.00 and total launch points = 6,000.
-- ---------------------------------------------------------------------------
insert into public.loyalty_campaigns(code,name,description,currency,purchase_price_cents,purchased_credit_cents,reward_value_cap_cents,max_enrollments_per_user,active,config)
values('launch_offer_45','Offre lancement CHF 45','CHF 45 de crédit acheté + jusqu’à CHF 45 de récompenses à débloquer.','CHF',4500,4500,4500,1,true,
  '{"marketing_promise":"CHF 45 chargés + jusqu’à CHF 45 de récompenses à débloquer"}'::jsonb)
on conflict(code) do update set name=excluded.name,description=excluded.description,purchase_price_cents=4500,purchased_credit_cents=4500,reward_value_cap_cents=4500,max_enrollments_per_user=1,active=true,updated_at=now();

with c as (select id from public.loyalty_campaigns where code='launch_offer_45')
insert into public.loyalty_missions(campaign_id,code,name,description,metric,threshold,reward_points,reward_value_cents,sort_order)
select c.id,v.code,v.name,v.description,v.metric,v.threshold,v.points,v.value_cents,v.sort_order from c cross join (values
  ('first_rental','Première location','Terminer une première location correctement.','completed_rentals',1::bigint,250::bigint,200,10),
  ('first_return','Premier retour','Rendre correctement une première batterie.','completed_rentals',1::bigint,250::bigint,200,20),
  ('three_rentals','3 locations','Terminer trois locations correctement.','completed_rentals',3::bigint,600::bigint,500,30),
  ('explore_network','Explorer le réseau','Utiliser au moins deux bornes différentes.','distinct_stations',2::bigint,600::bigint,500,40),
  ('spent_10','CHF 10 utilisés','Atteindre CHF 10 de consommation réelle.','spent_cents',1000::bigint,1000::bigint,800,50),
  ('spent_25','CHF 25 utilisés','Atteindre CHF 25 de consommation réelle.','spent_cents',2500::bigint,1500::bigint,1300,60),
  ('spent_45','Pack entièrement utilisé','Atteindre CHF 45 de consommation réelle.','spent_cents',4500::bigint,1800::bigint,1000,70)
) as v(code,name,description,metric,threshold,points,value_cents,sort_order)
on conflict(campaign_id,code) do update set name=excluded.name,description=excluded.description,metric=excluded.metric,threshold=excluded.threshold,reward_points=excluded.reward_points,reward_value_cents=excluded.reward_value_cents,sort_order=excluded.sort_order,active=true,updated_at=now();

with c as (select id from public.loyalty_campaigns where code='launch_offer_45')
insert into public.rewards_catalog(campaign_id,code,name,description,reward_type,points_cost,reward_value_cents,wallet_credit_cents,active,config)
select c.id,v.code,v.name,v.description,'wallet_credit',v.points,v.value_cents,v.credit_cents,true,'{}'::jsonb from c cross join (values
  ('launch_credit_2','CHF 2 de crédit','Ajoute CHF 2 au crédit Chargeurs.',500::bigint,200,200),
  ('launch_credit_5','CHF 5 de crédit','Ajoute CHF 5 au crédit Chargeurs.',1100::bigint,500,500),
  ('launch_credit_10','CHF 10 de crédit','Ajoute CHF 10 au crédit Chargeurs.',2000::bigint,1000,1000),
  ('launch_credit_45','CHF 45 de crédit','Récompense maximale de lancement après progression complète.',6000::bigint,4500,4500)
) as v(code,name,description,points,value_cents,credit_cents)
on conflict(code) do update set campaign_id=excluded.campaign_id,name=excluded.name,description=excluded.description,points_cost=excluded.points_cost,reward_value_cents=excluded.reward_value_cents,wallet_credit_cents=excluded.wallet_credit_cents,active=true,updated_at=now();

-- Assertions: pricing examples from the product brief and campaign hard cap.
do $assertions$
declare
  v_profile uuid;
  v_sum integer;
  v_snap jsonb;
begin
  select id into v_profile from public.price_profiles where name='Chargeurs.ch Client' and active=true;
  if v_profile is null then raise exception 'PASS_MEMBER_PROFILE_MISSING'; end if;
  if not exists(select 1 from public.price_profiles where id=v_profile and initial_fee_cents=0 and period_minutes=30 and price_per_period_cents=50 and min_amount_cents=200 and daily_cap_cents=0) then
    raise exception 'PASS_MEMBER_PRICING_ASSERTION_FAILED';
  end if;
  v_snap:=public.compute_customer_pricing_snapshot('DTA21269','member',now(),now()+interval '20 minutes','active','normal','CHF');
  if (v_snap->>'final_cents')::integer<>200 then raise exception 'PASS_PRICE_20M_FAILED'; end if;
  v_snap:=public.compute_customer_pricing_snapshot('DTA21269','member',now(),now()+interval '2 hours 30 minutes','active','normal','CHF');
  if (v_snap->>'final_cents')::integer<>250 then raise exception 'PASS_PRICE_150M_FAILED'; end if;
  v_snap:=public.compute_customer_pricing_snapshot('DTA21269','member',now(),now()+interval '3 hours','active','normal','CHF');
  if (v_snap->>'final_cents')::integer<>300 then raise exception 'PASS_PRICE_180M_FAILED'; end if;
  select sum(m.reward_value_cents) into v_sum from public.loyalty_missions m join public.loyalty_campaigns c on c.id=m.campaign_id where c.code='launch_offer_45' and m.active;
  if v_sum<>4500 then raise exception 'PASS_LAUNCH_REWARD_VALUE_SUM_%',v_sum; end if;
end
$assertions$;
