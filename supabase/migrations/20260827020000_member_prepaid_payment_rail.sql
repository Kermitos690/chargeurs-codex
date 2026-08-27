-- Chargeurs.ch pilot member prepaid payment rail.
--
-- This migration introduces a first-class internal payment rail for members who
-- already hold at least CHF 30.00 of prepaid Chargeurs.ch credit. It does not
-- create a Stripe object and does not issue a hardware command.
--
-- Safety properties:
-- - existing QR/Terminal first-rail-wins semantics are preserved;
-- - the prepaid rail requires a v3 member pricing snapshot and current contract
--   acceptance;
-- - exactly CHF 30.00 is reserved before the rental can become financially
--   authoritative;
-- - the normal return commits only the v3 final price and releases the rest;
-- - historical v1/v2 rentals are never eligible.

alter table public.rental_payment_rail_claims
  drop constraint if exists rental_payment_rail_claims_rail_check;
alter table public.rental_payment_rail_claims
  add constraint rental_payment_rail_claims_rail_check
  check (rail in ('qr_checkout', 'stripe_terminal', 'membership_prepaid'));

alter table public.rental_sessions
  drop constraint if exists rental_sessions_settlement_strategy_check;
alter table public.rental_sessions
  add constraint rental_sessions_settlement_strategy_check
  check (settlement_strategy is null or settlement_strategy in ('manual_capture', 'prepaid_refund', 'membership_prepaid'));

alter table public.payments
  drop constraint if exists payments_settlement_strategy_check;
alter table public.payments
  add constraint payments_settlement_strategy_check
  check (settlement_strategy is null or settlement_strategy in ('manual_capture', 'prepaid_refund', 'membership_prepaid'));

create unique index if not exists payments_one_chargeurs_wallet_row_per_rental
  on public.payments (rental_session_id)
  where provider = 'chargeurs_wallet';

create or replace function public.claim_rental_payment_rail(
  p_rental_id uuid,
  p_rail text,
  p_correlation_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_existing public.rental_payment_rail_claims%rowtype;
  v_checkout_id text;
  v_payment_intent_id text;
begin
  if p_rail not in ('qr_checkout', 'stripe_terminal', 'membership_prepaid') then
    raise exception 'PAYMENT_RAIL_INVALID';
  end if;

  select stripe_checkout_session_id, stripe_payment_intent_id
    into v_checkout_id, v_payment_intent_id
  from public.rental_sessions
  where id = p_rental_id
  for update;
  if not found then raise exception 'RENTAL_NOT_FOUND'; end if;

  select * into v_existing
  from public.rental_payment_rail_claims
  where rental_session_id = p_rental_id
  for update;

  if found and v_existing.claim_state <> 'released' then
    if v_existing.rail <> p_rail then
      raise exception 'PAYMENT_RAIL_ALREADY_CLAIMED:%', v_existing.rail;
    end if;
    return case
      when v_existing.rail = 'stripe_terminal' then 'TERMINAL'
      when v_existing.rail = 'membership_prepaid' then 'PREPAID'
      else 'QR'
    end;
  end if;

  if p_rail in ('stripe_terminal', 'membership_prepaid')
     and coalesce(v_checkout_id, '') <> '' then
    raise exception 'PAYMENT_RAIL_ALREADY_CLAIMED:qr_checkout';
  end if;
  if p_rail = 'membership_prepaid' and coalesce(v_payment_intent_id, '') <> '' then
    raise exception 'PAYMENT_RAIL_ALREADY_CLAIMED:stripe';
  end if;

  insert into public.rental_payment_rail_claims(
    rental_session_id, rail, claim_state, claimed_at, correlation_id, metadata,
    released_at, release_reason
  ) values (
    p_rental_id, p_rail, 'engaged', now(), p_correlation_id,
    coalesce(p_metadata, '{}'::jsonb), null, null
  )
  on conflict (rental_session_id) do update set
    rail = excluded.rail,
    claim_state = 'engaged',
    claimed_at = now(),
    correlation_id = excluded.correlation_id,
    metadata = excluded.metadata,
    released_at = null,
    release_reason = null;

  return case
    when p_rail = 'stripe_terminal' then 'TERMINAL'
    when p_rail = 'membership_prepaid' then 'PREPAID'
    else 'QR'
  end;
end;
$function$;

create or replace function public.authorize_member_prepaid_rental(
  p_rental_id uuid,
  p_kiosk_device_id uuid,
  p_correlation_id uuid default null
)
returns table(
  authorized boolean,
  reason text,
  reserved_cents bigint,
  currency text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_session public.rental_sessions%rowtype;
  v_snapshot jsonb;
  v_orch public.rental_orchestrator_snapshots%rowtype;
  v_reservation record;
  v_rail text;
  v_now timestamptz := now();
  v_terms constant text := 'terms-2026-08-26-preproduction-v2';
  v_privacy constant text := 'privacy-2026-08-26-preproduction-v2';
  v_required constant bigint := 3000;
begin
  select * into v_session
  from public.rental_sessions
  where id = p_rental_id
  for update;
  if not found then raise exception 'RENTAL_NOT_FOUND'; end if;

  if v_session.kiosk_device_id is distinct from p_kiosk_device_id then
    raise exception 'KIOSK_DEVICE_MISMATCH';
  end if;
  if v_session.expires_at is not null and v_session.expires_at <= v_now then
    raise exception 'SESSION_EXPIRED';
  end if;
  if v_session.customer_segment <> 'member' or v_session.customer_user_id is null then
    return query select false, 'NOT_MEMBER'::text, 0::bigint, 'CHF'::text;
    return;
  end if;
  if v_session.contract_terms_version is distinct from v_terms
     or v_session.contract_privacy_version is distinct from v_privacy
     or v_session.contract_accepted_at is null then
    raise exception 'CONTRACT_ACCEPTANCE_REQUIRED';
  end if;

  v_snapshot := v_session.pricing_snapshot;
  if v_snapshot is null
     or coalesce((v_snapshot->>'pricing_rules_version')::integer, 0) <> 3
     or coalesce(v_snapshot->>'customer_segment', '') <> 'member'
     or upper(coalesce(v_snapshot->>'currency', '')) <> 'CHF'
     or coalesce((v_snapshot->>'deposit_cents')::bigint, 0) <> v_required
     or coalesce((v_snapshot->>'unreturned_fee_cents')::bigint, 0) <> v_required
     or coalesce((v_snapshot->>'unreturned_after_minutes')::integer, 0) <> 4320
     or coalesce((v_snapshot->>'max_amount_cents')::bigint, 0) <> v_required then
    raise exception 'MEMBER_PREPAID_V3_SNAPSHOT_REQUIRED';
  end if;

  if v_session.settlement_strategy = 'membership_prepaid'
     and v_session.settlement_status = 'prepaid'
     and v_session.membership_credit_applied_cents - v_session.membership_credit_reversed_cents >= v_required then
    return query select true, 'ALREADY_AUTHORIZED'::text,
      (v_session.membership_credit_applied_cents - v_session.membership_credit_reversed_cents)::bigint,
      'CHF'::text;
    return;
  end if;

  if v_session.paid_at is not null
     or v_session.stripe_checkout_session_id is not null
     or v_session.stripe_payment_intent_id is not null then
    raise exception 'PAYMENT_ALREADY_STARTED';
  end if;
  if v_session.state not in ('created', 'payment_pending') then
    raise exception 'SESSION_NOT_PREPAID_AUTHORIZABLE';
  end if;

  v_rail := public.claim_rental_payment_rail(
    p_rental_id,
    'membership_prepaid',
    p_correlation_id,
    jsonb_build_object('source', 'member_prepaid_balance', 'required_cents', v_required)
  );
  if v_rail <> 'PREPAID' then raise exception 'MEMBER_PREPAID_RAIL_CLAIM_FAILED'; end if;

  select * into v_reservation
  from public.apply_customer_membership_credit_to_rental(
    p_rental_id,
    v_required,
    v_required
  );

  if coalesce(v_reservation.requirement_met, false) is not true
     or coalesce(v_reservation.applied_cents, 0) <> v_required
     or upper(coalesce(v_reservation.currency, '')) <> 'CHF' then
    perform public.release_rental_payment_rail_claim(
      p_rental_id,
      'membership_prepaid',
      'insufficient_prepaid_balance'
    );
    return query select false, 'INSUFFICIENT_PREPAID_BALANCE'::text, 0::bigint, 'CHF'::text;
    return;
  end if;

  select * into v_orch
  from public.rental_orchestrator_snapshots
  where rental_id = p_rental_id
  for update;
  if not found then raise exception 'ORCHESTRATOR_SNAPSHOT_MISSING'; end if;

  if v_orch.state = 'created' then
    select * into v_orch
    from public.append_rental_orchestrator_event(
      p_rental_id,
      v_orch.version,
      'payment_started',
      format('payment_started:membership_prepaid:%s', p_rental_id),
      v_now,
      jsonb_build_object('source', 'membership_prepaid', 'reserved_cents', v_required),
      'payment_pending',
      null,
      v_session.station_id,
      v_session.battery_id,
      null,
      null
    );
  end if;
  if v_orch.state <> 'payment_pending' then raise exception 'ORCHESTRATOR_NOT_PAYMENT_PENDING'; end if;

  select * into v_orch
  from public.append_rental_orchestrator_event(
    p_rental_id,
    v_orch.version,
    'payment_authorized',
    format('payment_authorized:membership_prepaid:%s', p_rental_id),
    v_now,
    jsonb_build_object(
      'source', 'membership_prepaid',
      'reserved_cents', v_required,
      'currency', 'CHF',
      'stripe_side_effect', false
    ),
    'authorized',
    null,
    v_session.station_id,
    v_session.battery_id,
    null,
    null
  );

  update public.rental_sessions
  set state = 'payment_succeeded',
      settlement_strategy = 'membership_prepaid',
      settlement_status = 'prepaid',
      settlement_error = null,
      paid_at = v_now,
      amount_paid = 0,
      captured_amount_cents = 0,
      refunded_amount_cents = 0,
      supplemental_amount_cents = 0,
      updated_at = v_now
  where id = p_rental_id;

  insert into public.payments(
    rental_session_id, provider, amount, currency, payment_method, status,
    settlement_strategy, amount_authorized_cents, amount_captured_cents,
    amount_refunded_cents
  ) values (
    p_rental_id, 'chargeurs_wallet', 0, 'CHF', 'prepaid_balance', 'authorized',
    'membership_prepaid', v_required, 0, 0
  )
  on conflict (rental_session_id) where provider = 'chargeurs_wallet'
  do update set
    status = 'authorized',
    settlement_strategy = 'membership_prepaid',
    amount_authorized_cents = v_required;

  insert into public.audit_logs(action, target, data)
  values (
    'membership_prepaid.rental_authorized',
    p_rental_id::text,
    jsonb_build_object(
      'reserved_cents', v_required,
      'currency', 'CHF',
      'pricing_rules_version', 3,
      'stripe_side_effect', false,
      'correlation_id', p_correlation_id
    )
  );

  return query select true, 'AUTHORIZED'::text, v_required, 'CHF'::text;
exception
  when others then
    -- The RPC is one PostgreSQL transaction. Any reservation/rail/orchestrator
    -- mutation above is rolled back automatically when an exception escapes.
    raise;
end;
$function$;

revoke all on function public.authorize_member_prepaid_rental(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.authorize_member_prepaid_rental(uuid, uuid, uuid) to service_role;

create or replace function public.settle_member_prepaid_on_return()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_pricing jsonb;
  v_final bigint;
  v_committed bigint;
  v_orch public.rental_orchestrator_snapshots%rowtype;
  v_now timestamptz := now();
  v_snapshot jsonb;
begin
  if old.returned_at is not null
     or new.returned_at is null
     or new.settlement_strategy <> 'membership_prepaid'
     or new.settlement_status <> 'prepaid' then
    return new;
  end if;

  v_snapshot := new.pricing_snapshot;
  if v_snapshot is null
     or coalesce((v_snapshot->>'pricing_rules_version')::integer, 0) <> 3
     or coalesce(v_snapshot->>'customer_segment', '') <> 'member' then
    raise exception 'MEMBER_PREPAID_V3_SNAPSHOT_REQUIRED';
  end if;
  if new.membership_credit_applied_cents - new.membership_credit_reversed_cents <> 3000 then
    raise exception 'MEMBER_PREPAID_RESERVATION_NOT_3000';
  end if;

  v_pricing := public.customer_wallet_pricing_state(
    v_snapshot,
    coalesce(new.started_at, new.ejected_at, new.created_at),
    new.returned_at
  );
  if v_pricing is null then raise exception 'MEMBER_PREPAID_PRICING_FAILED'; end if;
  v_final := coalesce((v_pricing->>'final_cents')::bigint, -1);
  if v_final < 0 or v_final > 3000 then raise exception 'MEMBER_PREPAID_FINAL_AMOUNT_INVALID'; end if;

  v_committed := public.commit_customer_membership_credit_for_rental(new.id, v_final);
  if v_committed <> v_final then raise exception 'MEMBER_PREPAID_COMMIT_MISMATCH'; end if;

  select * into v_orch
  from public.rental_orchestrator_snapshots
  where rental_id = new.id
  for update;
  if not found then raise exception 'ORCHESTRATOR_SNAPSHOT_MISSING'; end if;
  if v_orch.state <> 'return_detected' then raise exception 'ORCHESTRATOR_NOT_RETURN_DETECTED'; end if;

  select * into v_orch
  from public.append_rental_orchestrator_event(
    new.id, v_orch.version, 'pricing_finalized',
    format('pricing_finalized:membership_prepaid:%s', new.id),
    new.returned_at,
    jsonb_build_object(
      'source', 'membership_prepaid',
      'finalAmountCents', v_final,
      'pricingSnapshot', v_snapshot || v_pricing
    ),
    'pricing_finalized', null, new.station_id, new.battery_id,
    v_final::numeric / 100, null
  );

  select * into v_orch
  from public.append_rental_orchestrator_event(
    new.id, v_orch.version, 'payment_captured',
    format('payment_captured:membership_prepaid:%s', new.id),
    v_now,
    jsonb_build_object(
      'source', 'membership_prepaid',
      'committed_cents', v_final,
      'released_cents', 3000 - v_final,
      'stripe_side_effect', false
    ),
    'payment_captured', null, new.station_id, new.battery_id,
    v_final::numeric / 100, null
  );

  select * into v_orch
  from public.append_rental_orchestrator_event(
    new.id, v_orch.version, 'rental_completed',
    format('rental_completed:membership_prepaid:%s', new.id),
    v_now,
    jsonb_build_object('source', 'membership_prepaid', 'final_amount_cents', v_final),
    'completed', null, new.station_id, new.battery_id,
    v_final::numeric / 100, null
  );

  update public.payments
  set amount = v_final::numeric / 100,
      status = 'succeeded',
      amount_authorized_cents = 3000,
      amount_captured_cents = v_final,
      amount_refunded_cents = 0
  where rental_session_id = new.id and provider = 'chargeurs_wallet';

  update public.rental_sessions
  set state = 'completed',
      final_amount_cents = v_final,
      amount_paid = v_final::numeric / 100,
      captured_amount_cents = v_final,
      refunded_amount_cents = 0,
      supplemental_amount_cents = 0,
      settlement_status = 'settled',
      settlement_error = null,
      settlement_locked_at = null,
      completed_at = coalesce(completed_at, v_now),
      closed_at = coalesce(closed_at, v_now),
      updated_at = v_now
  where id = new.id;

  insert into public.audit_logs(action, target, data)
  values (
    'membership_prepaid.rental_settled',
    new.id::text,
    jsonb_build_object(
      'reserved_cents', 3000,
      'committed_cents', v_final,
      'released_cents', 3000 - v_final,
      'currency', 'CHF',
      'stripe_side_effect', false
    )
  );

  return new;
end;
$function$;

drop trigger if exists trg_settle_member_prepaid_on_return on public.rental_sessions;
create trigger trg_settle_member_prepaid_on_return
after update of returned_at on public.rental_sessions
for each row
when (old.returned_at is null and new.returned_at is not null)
execute function public.settle_member_prepaid_on_return();

revoke all on function public.settle_member_prepaid_on_return() from public, anon, authenticated;

-- Static invariants fail migration application rather than silently creating a
-- hybrid Stripe/wallet rail.
do $assertions$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.rental_payment_rail_claims'::regclass
      and conname = 'rental_payment_rail_claims_rail_check'
      and pg_get_constraintdef(oid) like '%membership_prepaid%'
  ) then raise exception 'MEMBER_PREPAID_RAIL_CONSTRAINT_MISSING'; end if;

  if has_function_privilege('anon', 'public.authorize_member_prepaid_rental(uuid,uuid,uuid)', 'execute') then
    raise exception 'MEMBER_PREPAID_AUTH_RPC_EXPOSED_TO_ANON';
  end if;
end
$assertions$;
