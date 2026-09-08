-- Stripe Terminal TEST lifecycle convergence for #169/#171.
-- Adds explicit claim recovery state and restart/reconciliation metadata.
-- No pricing, ejection, return or settlement formulas are changed.

alter table public.rental_payment_rail_claims
  add column if not exists claim_state text not null default 'engaged'
    check (claim_state in ('engaged','reconciliation_required','released')),
  add column if not exists released_at timestamptz,
  add column if not exists release_reason text;

alter table public.stripe_terminal_payment_attempts
  add column if not exists attempt_generation integer not null default 1,
  add column if not exists previous_payment_intent_ids text[] not null default '{}'::text[],
  add column if not exists reconciliation_required boolean not null default false,
  add column if not exists last_reconciled_at timestamptz,
  add column if not exists canceled_at timestamptz,
  add column if not exists timed_out_at timestamptz,
  add column if not exists last_stripe_event_id text;

alter table public.stripe_terminal_payment_attempts
  drop constraint if exists stripe_terminal_payment_attempts_status_check;
alter table public.stripe_terminal_payment_attempts
  add constraint stripe_terminal_payment_attempts_status_check check (
    status in (
      'creating','requires_payment_method','requires_confirmation','requires_action','processing',
      'requires_capture','succeeded','canceled','failed','reconciliation_required','timed_out'
    )
  );

create or replace function public.claim_rental_payment_rail(
  p_rental_id uuid,
  p_rail text,
  p_correlation_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.rental_payment_rail_claims%rowtype;
  v_checkout_id text;
begin
  if p_rail not in ('qr_checkout','stripe_terminal') then
    raise exception 'PAYMENT_RAIL_INVALID';
  end if;

  select stripe_checkout_session_id into v_checkout_id
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
    return case when v_existing.rail = 'stripe_terminal' then 'TERMINAL' else 'QR' end;
  end if;

  if p_rail = 'stripe_terminal' and coalesce(v_checkout_id, '') <> '' then
    raise exception 'PAYMENT_RAIL_ALREADY_CLAIMED:qr_checkout';
  end if;

  insert into public.rental_payment_rail_claims(
    rental_session_id, rail, claim_state, claimed_at, correlation_id, metadata, released_at, release_reason
  ) values (
    p_rental_id, p_rail, 'engaged', now(), p_correlation_id, coalesce(p_metadata, '{}'::jsonb), null, null
  )
  on conflict (rental_session_id) do update set
    rail = excluded.rail,
    claim_state = 'engaged',
    claimed_at = now(),
    correlation_id = excluded.correlation_id,
    metadata = excluded.metadata,
    released_at = null,
    release_reason = null;

  return case when p_rail = 'stripe_terminal' then 'TERMINAL' else 'QR' end;
end;
$$;

create or replace function public.mark_rental_payment_rail_reconciliation_required(
  p_rental_id uuid,
  p_rail text,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.rental_payment_rail_claims
  set claim_state = 'reconciliation_required',
      metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object('reconciliation_reason', left(coalesce(p_reason,''),200))
  where rental_session_id = p_rental_id
    and rail = p_rail
    and claim_state <> 'released';
end;
$$;

create or replace function public.release_rental_payment_rail_claim(
  p_rental_id uuid,
  p_expected_rail text,
  p_reason text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim public.rental_payment_rail_claims%rowtype;
  v_attempt public.stripe_terminal_payment_attempts%rowtype;
begin
  select * into v_claim
  from public.rental_payment_rail_claims
  where rental_session_id = p_rental_id
  for update;

  if not found then return 'NONE'; end if;
  if v_claim.rail <> p_expected_rail then
    raise exception 'PAYMENT_RAIL_ALREADY_CLAIMED:%', v_claim.rail;
  end if;
  if v_claim.claim_state = 'released' then return 'NONE'; end if;

  if p_expected_rail = 'stripe_terminal' then
    select * into v_attempt
    from public.stripe_terminal_payment_attempts
    where rental_session_id = p_rental_id;

    if found then
      if v_attempt.reconciliation_required then
        raise exception 'PAYMENT_RAIL_RECONCILIATION_REQUIRED';
      end if;
      if v_attempt.stripe_payment_intent_id is not null
         and v_attempt.status not in ('canceled','failed','timed_out') then
        raise exception 'PAYMENT_RAIL_STRIPE_SIDE_EFFECT_ACTIVE';
      end if;
    end if;
  end if;

  update public.rental_payment_rail_claims
  set claim_state = 'released',
      released_at = now(),
      release_reason = left(coalesce(p_reason,'unspecified'),200)
  where rental_session_id = p_rental_id;

  return 'NONE';
end;
$$;

revoke all on function public.claim_rental_payment_rail(uuid,text,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.mark_rental_payment_rail_reconciliation_required(uuid,text,text) from public, anon, authenticated;
revoke all on function public.release_rental_payment_rail_claim(uuid,text,text) from public, anon, authenticated;
grant execute on function public.claim_rental_payment_rail(uuid,text,uuid,jsonb) to service_role;
grant execute on function public.mark_rental_payment_rail_reconciliation_required(uuid,text,text) to service_role;
grant execute on function public.release_rental_payment_rail_claim(uuid,text,text) to service_role;

create or replace function public.guard_qr_checkout_payment_rail()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim public.rental_payment_rail_claims%rowtype;
begin
  if new.stripe_checkout_session_id is distinct from old.stripe_checkout_session_id
     and new.stripe_checkout_session_id is not null then
    select * into v_claim
    from public.rental_payment_rail_claims
    where rental_session_id = new.id
    for update;

    if found and v_claim.claim_state <> 'released' and v_claim.rail = 'stripe_terminal' then
      raise exception 'PAYMENT_RAIL_ALREADY_CLAIMED:stripe_terminal';
    end if;

    perform public.claim_rental_payment_rail(
      new.id,
      'qr_checkout',
      null,
      jsonb_build_object('source','rental_sessions_checkout_projection')
    );
  end if;
  return new;
end;
$$;

revoke all on function public.guard_qr_checkout_payment_rail() from public, anon, authenticated;
grant execute on function public.guard_qr_checkout_payment_rail() to service_role;

comment on function public.release_rental_payment_rail_claim(uuid,text,text) is
  'Releases first-rail claim only when Terminal has no uncertain/active Stripe side effect.';
