-- The output column named `currency` of this table-returning function is a
-- PL/pgSQL variable. Qualify the ledger column explicitly so that reserving a
-- Chargeurs+ credit cannot fail with PostgreSQL 42702 during settlement.

CREATE OR REPLACE FUNCTION public.apply_customer_membership_credit_to_rental(
  p_rental_id uuid,
  p_final_amount_cents bigint,
  p_minimum_credit_cents bigint default 0
)
RETURNS TABLE(applied_cents bigint, currency text, requirement_met boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user_id uuid;
  v_membership_id uuid;
  v_existing bigint;
  v_reversed bigint;
  v_reservation_version integer;
  v_balance bigint;
  v_applied bigint;
  v_key text;
BEGIN
  IF p_final_amount_cents < 0 OR p_minimum_credit_cents < 0 OR p_minimum_credit_cents > p_final_amount_cents THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MEMBERSHIP_CREDIT_FINAL_AMOUNT_INVALID';
  END IF;

  SELECT customer_user_id, membership_credit_applied_cents, membership_credit_reversed_cents, membership_credit_reservation_version
    INTO v_user_id, v_existing, v_reversed, v_reservation_version
  FROM public.rental_sessions
  WHERE id = p_rental_id AND customer_segment = 'member'
  FOR UPDATE;

  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT 0::bigint, 'CHF'::text, (p_minimum_credit_cents = 0);
    RETURN;
  END IF;
  IF coalesce(v_existing, 0) > coalesce(v_reversed, 0) THEN
    RETURN QUERY SELECT v_existing - coalesce(v_reversed, 0), 'CHF'::text, (v_existing - coalesce(v_reversed, 0) >= p_minimum_credit_cents);
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('customer-membership-credit:' || v_user_id::text, 0));
  SELECT id INTO v_membership_id
  FROM public.customer_memberships
  WHERE user_id = v_user_id AND status = 'active'
  ORDER BY updated_at DESC
  LIMIT 1;
  IF v_membership_id IS NULL THEN
    RETURN QUERY SELECT 0::bigint, 'CHF'::text, (p_minimum_credit_cents = 0);
    RETURN;
  END IF;

  SELECT coalesce(sum(ledger.amount_cents) FILTER (WHERE ledger.expires_at IS NULL OR ledger.expires_at > now()), 0)::bigint
    INTO v_balance
  FROM public.customer_membership_credit_ledger AS ledger
  WHERE ledger.user_id = v_user_id AND ledger.currency = 'CHF';
  IF coalesce(v_balance, 0) < p_minimum_credit_cents THEN
    RETURN QUERY SELECT 0::bigint, 'CHF'::text, false;
    RETURN;
  END IF;
  v_applied := greatest(0, least(p_final_amount_cents, coalesce(v_balance, 0)));

  IF v_applied > 0 THEN
    v_key := format('membership_credit_reservation:%s:%s', p_rental_id, coalesce(v_reservation_version, 0) + 1);
    INSERT INTO public.customer_membership_credit_ledger(
      membership_id, user_id, rental_session_id, entry_type, amount_cents, currency, reason, idempotency_key, metadata
    ) VALUES (
      v_membership_id, v_user_id, p_rental_id, 'rental_reservation', -v_applied::integer, 'CHF',
      'rental_settlement_reserved', v_key, jsonb_build_object('final_amount_cents', p_final_amount_cents)
    ) ON CONFLICT (idempotency_key) DO NOTHING;
    SELECT abs(amount_cents)::bigint INTO v_applied
    FROM public.customer_membership_credit_ledger WHERE idempotency_key = v_key;
  END IF;

  UPDATE public.rental_sessions
  SET membership_credit_applied_cents = coalesce(v_existing, 0) + v_applied,
      membership_credit_reservation_version = CASE WHEN v_applied > 0 THEN coalesce(v_reservation_version, 0) + 1 ELSE coalesce(v_reservation_version, 0) END,
      membership_credit_reservation_status = CASE WHEN v_applied > 0 THEN 'reserved' ELSE membership_credit_reservation_status END
  WHERE id = p_rental_id;
  PERFORM public.refresh_customer_wallet_pass_credit_revision(v_user_id);
  RETURN QUERY SELECT v_applied, 'CHF'::text, true;
END;
$function$;
