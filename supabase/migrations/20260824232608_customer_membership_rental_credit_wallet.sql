-- Monetary rental credit for Chargeurs+ members.
-- This is deliberately separate from the legacy `wallets` tables: a Pass
-- credit is a membership benefit, not stored value or a Stripe substitute.

create table public.customer_membership_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.customer_memberships(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rental_session_id uuid references public.rental_sessions(id) on delete set null,
  entry_type text not null check (entry_type in ('grant','rental_reservation','rental_settlement_committed','rental_reversal')),
  amount_cents integer not null check (
    (entry_type = 'rental_settlement_committed' and amount_cents = 0)
    or (entry_type <> 'rental_settlement_committed' and amount_cents <> 0)
  ),
  currency text not null default 'CHF' check (currency = 'CHF'),
  reason text not null,
  idempotency_key text not null unique,
  balance_before_cents bigint not null default 0,
  balance_after_cents bigint not null default 0,
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index customer_membership_credit_ledger_user_idx
  on public.customer_membership_credit_ledger(user_id, created_at desc);
create index customer_membership_credit_ledger_membership_idx
  on public.customer_membership_credit_ledger(membership_id, created_at desc);

alter table public.customer_membership_credit_ledger enable row level security;
create policy "users read own membership credit" on public.customer_membership_credit_ledger
  for select to authenticated using ((select auth.uid()) = user_id);

-- Every immutable entry carries the resulting authoritative available balance.
-- The advisory locks in the writer RPCs serialize entries for a member; this
-- trigger makes an out-of-band insert fail visibly rather than creating an
-- untraceable balance mutation.
create or replace function public.annotate_customer_membership_credit_balance()
returns trigger language plpgsql security definer set search_path = public as $function$
declare v_before bigint;
begin
  select coalesce(sum(amount_cents) filter (where expires_at is null or expires_at > now()), 0)::bigint
    into v_before
  from public.customer_membership_credit_ledger
  where user_id = new.user_id and currency = new.currency;
  if v_before + new.amount_cents < 0 then
    raise exception using errcode = 'P0001', message = 'MEMBERSHIP_CREDIT_INSUFFICIENT_AVAILABLE_BALANCE';
  end if;
  new.balance_before_cents := v_before;
  new.balance_after_cents := v_before + new.amount_cents;
  new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
    'balance_before_cents', new.balance_before_cents,
    'balance_after_cents', new.balance_after_cents
  );
  return new;
end;
$function$;

create trigger trg_customer_membership_credit_balance
before insert on public.customer_membership_credit_ledger
for each row execute function public.annotate_customer_membership_credit_balance();

create or replace function public.prevent_customer_membership_credit_mutation()
returns trigger language plpgsql security definer set search_path = public as $function$
begin
  raise exception using errcode = '55000', message = 'MEMBERSHIP_CREDIT_LEDGER_IMMUTABLE';
end;
$function$;

create trigger trg_customer_membership_credit_immutable
before update or delete on public.customer_membership_credit_ledger
for each row execute function public.prevent_customer_membership_credit_mutation();

alter table public.rental_sessions
  add column if not exists membership_credit_applied_cents bigint not null default 0
    check (membership_credit_applied_cents >= 0),
  add column if not exists membership_credit_reversed_cents bigint not null default 0
    check (membership_credit_reversed_cents >= 0),
  add column if not exists membership_credit_committed_cents bigint not null default 0
    check (membership_credit_committed_cents >= 0),
  add column if not exists membership_credit_reservation_version integer not null default 0
    check (membership_credit_reservation_version >= 0),
  add column if not exists membership_credit_reservation_status text not null default 'none'
    check (membership_credit_reservation_status in ('none','reserved','reconciliation_required','committed','reversed'));

create or replace view public.customer_membership_credit_balances
with (security_invoker = true) as
select
  user_id,
  currency,
  coalesce(sum(amount_cents) filter (where expires_at is null or expires_at > now()), 0)::bigint as balance_cents,
  min(expires_at) filter (where amount_cents > 0 and expires_at > now()) as next_expiry_at,
  max(created_at) as last_activity_at
from public.customer_membership_credit_ledger
group by user_id, currency;

grant select on public.customer_membership_credit_balances to authenticated;

create or replace function public.refresh_customer_wallet_pass_credit_revision(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $function$
begin
  update public.customer_wallet_passes
  set pass_revision = pass_revision + 1,
      provider_status = case when provider_status = 'issued' then 'update_pending' else provider_status end,
      updated_at = now()
  where user_id = p_user_id and status = 'active';
end;
$function$;

create or replace function public.grant_customer_membership_period_credit(
  p_membership_id uuid,
  p_period_start timestamptz,
  p_source text default 'membership_period'
)
returns bigint language plpgsql security definer set search_path = public as $function$
declare
  v_user_id uuid;
  v_credit_cents integer;
  v_currency text;
  v_period_start timestamptz;
  v_expires_at timestamptz;
  v_key text;
  v_inserted integer;
begin
  select m.user_id,
         p.renewal_credit_cents,
         p.currency,
         coalesce(p_period_start, m.stripe_current_period_start, m.current_period_start, m.starts_at, m.created_at),
         coalesce(m.stripe_current_period_end, m.current_period_end, m.renews_at, m.ends_at)
    into v_user_id, v_credit_cents, v_currency, v_period_start, v_expires_at
  from public.customer_memberships m
  join public.customer_membership_plans p on p.id = m.plan_id
  where m.id = p_membership_id and m.status = 'active' and p.active = true;

  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'MEMBERSHIP_CREDIT_MEMBERSHIP_NOT_ACTIVE';
  end if;
  if coalesce(v_credit_cents, 0) = 0 then return 0; end if;
  if coalesce(v_currency, 'CHF') <> 'CHF' then
    raise exception using errcode = 'P0001', message = 'MEMBERSHIP_CREDIT_CURRENCY_UNSUPPORTED';
  end if;

  v_key := format('membership_credit_grant:%s:%s', p_membership_id, to_char(v_period_start at time zone 'UTC', 'YYYYMMDDHH24MISS'));
  perform pg_advisory_xact_lock(hashtextextended('customer-membership-credit:' || v_user_id::text, 0));
  insert into public.customer_membership_credit_ledger(
    membership_id, user_id, entry_type, amount_cents, currency, reason, idempotency_key, expires_at, metadata
  ) values (
    p_membership_id, v_user_id, 'grant', v_credit_cents, v_currency, p_source, v_key, v_expires_at,
    jsonb_build_object('period_start', v_period_start, 'period_end', v_expires_at)
  ) on conflict (idempotency_key) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted > 0 then
    perform public.refresh_customer_wallet_pass_credit_revision(v_user_id);
  end if;
  return v_credit_cents;
end;
$function$;

create or replace function public.apply_customer_membership_credit_to_rental(
  p_rental_id uuid,
  p_reservation_cap_cents bigint,
  p_minimum_credit_cents bigint default 0
)
returns table(applied_cents bigint, currency text, requirement_met boolean)
language plpgsql security definer set search_path = public as $function$
declare
  v_user_id uuid;
  v_membership_id uuid;
  v_existing bigint;
  v_reversed bigint;
  v_reservation_version integer;
  v_balance bigint;
  v_applied bigint;
  v_reservation_expires_at timestamptz;
  v_key text;
begin
  if p_reservation_cap_cents < 0 or p_minimum_credit_cents < 0 or p_minimum_credit_cents > p_reservation_cap_cents then
    raise exception using errcode = '22023', message = 'MEMBERSHIP_CREDIT_RESERVATION_CAP_INVALID';
  end if;

  select customer_user_id, membership_credit_applied_cents, membership_credit_reversed_cents, membership_credit_reservation_version
    into v_user_id, v_existing, v_reversed, v_reservation_version
  from public.rental_sessions
  where id = p_rental_id and customer_segment = 'member'
  for update;

  if v_user_id is null then
    return query select 0::bigint, 'CHF'::text, (p_minimum_credit_cents = 0);
    return;
  end if;
  if coalesce(v_existing, 0) > coalesce(v_reversed, 0) then
    return query select v_existing - coalesce(v_reversed, 0), 'CHF'::text, (v_existing - coalesce(v_reversed, 0) >= p_minimum_credit_cents);
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('customer-membership-credit:' || v_user_id::text, 0));
  select id into v_membership_id
  from public.customer_memberships
  where user_id = v_user_id and status = 'active'
  order by updated_at desc
  limit 1;
  if v_membership_id is null then
    return query select 0::bigint, 'CHF'::text, (p_minimum_credit_cents = 0);
    return;
  end if;

  select coalesce(sum(amount_cents) filter (where expires_at is null or expires_at > now()), 0)::bigint
    into v_balance
  from public.customer_membership_credit_ledger
  where user_id = v_user_id and currency = 'CHF';
  if coalesce(v_balance, 0) < p_minimum_credit_cents then
    return query select 0::bigint, 'CHF'::text, false;
    return;
  end if;
  v_applied := greatest(0, least(p_reservation_cap_cents, coalesce(v_balance, 0)));

  select case when bool_or(expires_at is null) then null else min(expires_at) end
    into v_reservation_expires_at
  from public.customer_membership_credit_ledger
  where user_id = v_user_id and currency = 'CHF' and amount_cents > 0
    and (expires_at is null or expires_at > now());

  if v_applied > 0 then
    v_key := format('membership_credit_reservation:%s:%s', p_rental_id, coalesce(v_reservation_version, 0) + 1);
    insert into public.customer_membership_credit_ledger(
      membership_id, user_id, rental_session_id, entry_type, amount_cents, currency, reason, idempotency_key, expires_at, metadata
    ) values (
      v_membership_id, v_user_id, p_rental_id, 'rental_reservation', -v_applied::integer, 'CHF',
      'rental_payment_committed_reservation', v_key, v_reservation_expires_at,
      jsonb_build_object('reservation_cap_cents', p_reservation_cap_cents, 'minimum_credit_cents', p_minimum_credit_cents)
    ) on conflict (idempotency_key) do nothing;
    select abs(amount_cents)::bigint into v_applied
    from public.customer_membership_credit_ledger where idempotency_key = v_key;
  end if;

  update public.rental_sessions
  set membership_credit_applied_cents = coalesce(v_existing, 0) + v_applied,
      membership_credit_reservation_version = case when v_applied > 0 then coalesce(v_reservation_version, 0) + 1 else coalesce(v_reservation_version, 0) end,
      membership_credit_reservation_status = case when v_applied > 0 then 'reserved' else membership_credit_reservation_status end
  where id = p_rental_id;
  perform public.refresh_customer_wallet_pass_credit_revision(v_user_id);
  return query select v_applied, 'CHF'::text, true;
end;
$function$;

create or replace function public.commit_customer_membership_credit_for_rental(
  p_rental_id uuid,
  p_final_amount_cents bigint
)
returns bigint language plpgsql security definer set search_path = public as $function$
declare
  v_user_id uuid;
  v_membership_id uuid;
  v_applied bigint;
  v_reversed bigint;
  v_committed bigint;
  v_open bigint;
  v_commit bigint;
  v_release bigint;
  v_version integer;
  v_expires_at timestamptz;
  v_key text := format('membership_credit_commit:%s', p_rental_id);
begin
  if p_final_amount_cents < 0 then raise exception using errcode = '22023', message = 'MEMBERSHIP_CREDIT_FINAL_AMOUNT_INVALID'; end if;
  select customer_user_id, membership_credit_applied_cents, membership_credit_reversed_cents, membership_credit_committed_cents, membership_credit_reservation_version
    into v_user_id, v_applied, v_reversed, v_committed, v_version
  from public.rental_sessions
  where id = p_rental_id
  for update;
  if v_user_id is null or coalesce(v_applied, 0) <= coalesce(v_reversed, 0) then return 0; end if;
  if coalesce(v_committed, 0) > 0 then return v_committed; end if;
  v_open := v_applied - coalesce(v_reversed, 0);
  v_commit := least(v_open, p_final_amount_cents);
  v_release := v_open - v_commit;

  select id into v_membership_id from public.customer_memberships
  where user_id = v_user_id order by updated_at desc limit 1;
  if v_membership_id is null then raise exception using errcode = 'P0001', message = 'MEMBERSHIP_CREDIT_MEMBERSHIP_MISSING'; end if;

  select expires_at into v_expires_at
  from public.customer_membership_credit_ledger
  where rental_session_id = p_rental_id and entry_type = 'rental_reservation'
  order by created_at desc limit 1;

  if v_release > 0 then
    insert into public.customer_membership_credit_ledger(
      membership_id, user_id, rental_session_id, entry_type, amount_cents, currency, reason, idempotency_key, expires_at, metadata
    ) values (
      v_membership_id, v_user_id, p_rental_id, 'rental_reversal', v_release::integer, 'CHF',
      'rental_settlement_unused_reservation_release', format('membership_credit_settlement_release:%s:%s', p_rental_id, v_version), v_expires_at,
      jsonb_build_object('reserved_cents', v_open, 'committed_cents', v_commit, 'released_cents', v_release)
    ) on conflict (idempotency_key) do nothing;
  end if;
  insert into public.customer_membership_credit_ledger(
    membership_id, user_id, rental_session_id, entry_type, amount_cents, currency, reason, idempotency_key, metadata
  ) values (
    v_membership_id, v_user_id, p_rental_id, 'rental_settlement_committed', 0, 'CHF',
    'rental_settlement_committed', v_key, jsonb_build_object('reserved_cents', v_open, 'committed_cents', v_commit, 'released_cents', v_release)
  ) on conflict (idempotency_key) do nothing;
  update public.rental_sessions
  set membership_credit_reversed_cents = membership_credit_reversed_cents + v_release,
      membership_credit_committed_cents = membership_credit_committed_cents + v_commit,
      membership_credit_reservation_status = 'committed'
  where id = p_rental_id;
  perform public.refresh_customer_wallet_pass_credit_revision(v_user_id);
  return v_commit;
end;
$function$;

create or replace function public.reverse_customer_membership_credit_for_rental(
  p_rental_id uuid,
  p_reason text default 'payment_settlement_reversed'
)
returns bigint language plpgsql security definer set search_path = public as $function$
declare
  v_user_id uuid;
  v_membership_id uuid;
  v_applied bigint;
  v_reversed bigint;
  v_committed bigint;
  v_open bigint;
  v_version integer;
  v_expires_at timestamptz;
  v_key text;
begin
  select customer_user_id, membership_credit_applied_cents, membership_credit_reversed_cents, membership_credit_committed_cents, membership_credit_reservation_version
    into v_user_id, v_applied, v_reversed, v_committed, v_version
  from public.rental_sessions
  where id = p_rental_id
  for update;
  if v_user_id is null or coalesce(v_applied, 0) <= coalesce(v_reversed, 0) then return 0; end if;
  if coalesce(v_committed, 0) > 0 then
    raise exception using errcode = 'P0001', message = 'MEMBERSHIP_CREDIT_COMMITTED_REVERSAL_REQUIRES_REFUND';
  end if;
  v_open := v_applied - coalesce(v_reversed, 0);
  v_key := format('membership_credit_reversal:%s:%s', p_rental_id, v_version);
  select id into v_membership_id from public.customer_memberships
  where user_id = v_user_id order by updated_at desc limit 1;
  if v_membership_id is null then raise exception using errcode = 'P0001', message = 'MEMBERSHIP_CREDIT_MEMBERSHIP_MISSING'; end if;

  select expires_at into v_expires_at
  from public.customer_membership_credit_ledger
  where rental_session_id = p_rental_id and entry_type = 'rental_reservation'
  order by created_at desc limit 1;
  insert into public.customer_membership_credit_ledger(
    membership_id, user_id, rental_session_id, entry_type, amount_cents, currency, reason, idempotency_key, expires_at, metadata
  ) values (
    v_membership_id, v_user_id, p_rental_id, 'rental_reversal', v_open::integer,
    'CHF', p_reason, v_key, v_expires_at, jsonb_build_object('reversal_of', 'rental_reservation')
  ) on conflict (idempotency_key) do nothing;
  update public.rental_sessions
  set membership_credit_reversed_cents = membership_credit_applied_cents,
      membership_credit_reservation_status = 'reversed'
  where id = p_rental_id;
  perform public.refresh_customer_wallet_pass_credit_revision(v_user_id);
  return v_open;
end;
$function$;

revoke all on function public.refresh_customer_wallet_pass_credit_revision(uuid) from public, anon, authenticated;
revoke all on function public.annotate_customer_membership_credit_balance() from public, anon, authenticated;
revoke all on function public.prevent_customer_membership_credit_mutation() from public, anon, authenticated;
revoke all on function public.grant_customer_membership_period_credit(uuid,timestamptz,text) from public, anon, authenticated;
revoke all on function public.apply_customer_membership_credit_to_rental(uuid,bigint,bigint) from public, anon, authenticated;
revoke all on function public.commit_customer_membership_credit_for_rental(uuid,bigint) from public, anon, authenticated;
revoke all on function public.reverse_customer_membership_credit_for_rental(uuid,text) from public, anon, authenticated;
grant execute on function public.grant_customer_membership_period_credit(uuid,timestamptz,text) to service_role;
grant execute on function public.apply_customer_membership_credit_to_rental(uuid,bigint,bigint) to service_role;
grant execute on function public.commit_customer_membership_credit_for_rental(uuid,bigint) to service_role;
grant execute on function public.reverse_customer_membership_credit_for_rental(uuid,text) to service_role;

-- The active paid membership already present in staging receives its configured
-- per-period credit exactly once. The ledger key makes this safe to rerun.
do $block$
declare v_membership record;
begin
  for v_membership in
    select id, coalesce(stripe_current_period_start, current_period_start, starts_at, created_at) as period_start
    from public.customer_memberships where status = 'active'
  loop
    perform public.grant_customer_membership_period_credit(v_membership.id, v_membership.period_start, 'active_membership_backfill');
  end loop;
end;
$block$;
