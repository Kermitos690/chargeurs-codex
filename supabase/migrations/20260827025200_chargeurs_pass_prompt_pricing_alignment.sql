-- Chargeurs Pass pricing alignment with the approved loyalty brief.
-- Future member rentals only: historical rental_sessions.pricing_snapshot values are immutable.
-- Canonical member pricing: CHF 0.50 / 30 min, minimum CHF 2.00 per rental.
-- Non-return remains independent from loyalty: CHF 30 total at 72h.

DO $$
DECLARE
  v_profile_id uuid := 'f43b1e63-8ac2-4dcb-b284-dfcc2d7006e6'::uuid;
  v_before_version integer;
BEGIN
  SELECT version INTO v_before_version
  FROM public.price_profiles
  WHERE id = v_profile_id
    AND active = true
    AND name = 'Chargeurs.ch Client'
  FOR UPDATE;

  IF v_before_version IS NULL THEN
    RAISE EXCEPTION 'CHARGEURS_PASS_MEMBER_PROFILE_NOT_FOUND';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.price_profile_tiers WHERE price_profile_id = v_profile_id
  ) THEN
    RAISE EXCEPTION 'CHARGEURS_PASS_MEMBER_PROFILE_MUST_NOT_BE_TIERED';
  END IF;

  UPDATE public.price_profiles
  SET
    initial_fee_cents = 0,
    period_minutes = 30,
    price_per_period_cents = 50,
    min_amount_cents = 200,
    deposit_cents = 3000,
    unreturned_fee_cents = 3000,
    unreturned_after_minutes = 4320,
    total_cap_cents = 3000,
    max_amount_cents = 3000,
    updated_at = now()
  WHERE id = v_profile_id;

  IF NOT EXISTS (
    SELECT 1
    FROM public.price_profiles
    WHERE id = v_profile_id
      AND version > v_before_version
      AND initial_fee_cents = 0
      AND period_minutes = 30
      AND price_per_period_cents = 50
      AND min_amount_cents = 200
      AND deposit_cents = 3000
      AND unreturned_fee_cents = 3000
      AND unreturned_after_minutes = 4320
      AND total_cap_cents = 3000
      AND max_amount_cents = 3000
  ) THEN
    RAISE EXCEPTION 'CHARGEURS_PASS_MEMBER_PROFILE_ALIGNMENT_FAILED';
  END IF;
END $$;

-- Reservation guard must enforce the same immutable pricing contract used by
-- the wallet-backed rental rail. This only validates future reservations.
CREATE OR REPLACE FUNCTION public.enforce_pass_wallet_reservation_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_snapshot jsonb;
  v_user_id uuid;
BEGIN
  SELECT pricing_snapshot, customer_user_id
    INTO v_snapshot, v_user_id
  FROM public.rental_sessions
  WHERE id = NEW.rental_session_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'PASS_WALLET_RENTAL_NOT_FOUND'; END IF;
  IF v_user_id IS DISTINCT FROM NEW.user_id THEN RAISE EXCEPTION 'PASS_WALLET_RESERVATION_USER_MISMATCH'; END IF;
  IF upper(coalesce(NEW.currency, '')) <> 'CHF' OR NEW.held_cents <> 3000 THEN
    RAISE EXCEPTION 'PASS_WALLET_RESERVATION_AMOUNT_INVALID';
  END IF;
  IF v_snapshot IS NULL
     OR coalesce((v_snapshot->>'pricing_rules_version')::integer, 0) <> 3
     OR coalesce(v_snapshot->>'customer_segment', '') <> 'member'
     OR upper(coalesce(v_snapshot->>'currency', '')) <> 'CHF'
     OR coalesce((v_snapshot->>'deposit_cents')::integer, 0) <> 3000
     OR coalesce((v_snapshot->>'unreturned_fee_cents')::integer, 0) <> 3000
     OR coalesce((v_snapshot->>'unreturned_after_minutes')::integer, 0) <> 4320
     OR coalesce((v_snapshot->>'max_amount_cents')::integer, 0) <> 3000 THEN
    RAISE EXCEPTION 'PASS_WALLET_CANONICAL_V3_SNAPSHOT_REQUIRED';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_pass_wallet_reservation_snapshot() FROM PUBLIC;

-- Exact business examples from the approved Chargeurs Pass brief.
DO $$
DECLARE
  v_profile_id uuid := 'f43b1e63-8ac2-4dcb-b284-dfcc2d7006e6'::uuid;
  v_start timestamptz := '2026-01-01 00:00:00+00'::timestamptz;
  v_actual integer;
BEGIN
  SELECT (public.compute_profile_pricing(v_profile_id, v_start, v_start + interval '20 minutes', 'active', 'returned', 'CHF')->>'final_cents')::integer INTO v_actual;
  IF v_actual <> 200 THEN RAISE EXCEPTION 'PASS_PRICE_20_MIN_EXPECTED_200_GOT_%', v_actual; END IF;

  SELECT (public.compute_profile_pricing(v_profile_id, v_start, v_start + interval '60 minutes', 'active', 'returned', 'CHF')->>'final_cents')::integer INTO v_actual;
  IF v_actual <> 200 THEN RAISE EXCEPTION 'PASS_PRICE_60_MIN_EXPECTED_200_GOT_%', v_actual; END IF;

  SELECT (public.compute_profile_pricing(v_profile_id, v_start, v_start + interval '90 minutes', 'active', 'returned', 'CHF')->>'final_cents')::integer INTO v_actual;
  IF v_actual <> 200 THEN RAISE EXCEPTION 'PASS_PRICE_90_MIN_EXPECTED_200_GOT_%', v_actual; END IF;

  SELECT (public.compute_profile_pricing(v_profile_id, v_start, v_start + interval '120 minutes', 'active', 'returned', 'CHF')->>'final_cents')::integer INTO v_actual;
  IF v_actual <> 200 THEN RAISE EXCEPTION 'PASS_PRICE_120_MIN_EXPECTED_200_GOT_%', v_actual; END IF;

  SELECT (public.compute_profile_pricing(v_profile_id, v_start, v_start + interval '150 minutes', 'active', 'returned', 'CHF')->>'final_cents')::integer INTO v_actual;
  IF v_actual <> 250 THEN RAISE EXCEPTION 'PASS_PRICE_150_MIN_EXPECTED_250_GOT_%', v_actual; END IF;

  SELECT (public.compute_profile_pricing(v_profile_id, v_start, v_start + interval '180 minutes', 'active', 'returned', 'CHF')->>'final_cents')::integer INTO v_actual;
  IF v_actual <> 300 THEN RAISE EXCEPTION 'PASS_PRICE_180_MIN_EXPECTED_300_GOT_%', v_actual; END IF;

  SELECT (public.compute_profile_pricing(v_profile_id, v_start, v_start + interval '4320 minutes', 'active', null, 'CHF')->>'final_cents')::integer INTO v_actual;
  IF v_actual <> 3000 THEN RAISE EXCEPTION 'PASS_NONRETURN_72H_EXPECTED_3000_GOT_%', v_actual; END IF;

  IF (SELECT count(*) FROM public.customer_segment_price_profiles
      WHERE price_profile_id = v_profile_id AND segment = 'member' AND active = true
        AND station_id IN ('DTA21269','DTA21277','DTA22032')) <> 3 THEN
    RAISE EXCEPTION 'CHARGEURS_PASS_MEMBER_ASSIGNMENTS_INCOMPLETE';
  END IF;
END $$;
