-- The RETURNS TABLE output column "currency" is a PL/pgSQL variable.
-- Qualify ledger columns so wallet reservation cannot fail with SQLSTATE 42702.
create or replace function public.apply_customer_membership_credit_to_rental(
  p_rental_id uuid,
  p_reservation_cap_cents bigint,
  p_minimum_credit_cents bigint default 0
)
returns table(applied_cents bigint, currency text, requirement_met boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  select coalesce(sum(credit_ledger.amount_cents) filter (
      where credit_ledger.expires_at is null or credit_ledger.expires_at > now()
    ), 0)::bigint
    into v_balance
  from public.customer_membership_credit_ledger as credit_ledger
  where credit_ledger.user_id = v_user_id
    and credit_ledger.currency = 'CHF';
  if coalesce(v_balance, 0) < p_minimum_credit_cents then
    return query select 0::bigint, 'CHF'::text, false;
    return;
  end if;
  v_applied := greatest(0, least(p_reservation_cap_cents, coalesce(v_balance, 0)));

  select case
      when bool_or(credit_ledger.expires_at is null) then null
      else min(credit_ledger.expires_at)
    end
    into v_reservation_expires_at
  from public.customer_membership_credit_ledger as credit_ledger
  where credit_ledger.user_id = v_user_id
    and credit_ledger.currency = 'CHF'
    and credit_ledger.amount_cents > 0
    and (credit_ledger.expires_at is null or credit_ledger.expires_at > now());

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
