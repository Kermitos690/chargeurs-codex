-- Chargeurs.ch pilot pricing v3 — final member tariff correction.
--
-- Operator-approved member policy for NEW v3 rentals:
-- - CHF 2.00 through 2 hours;
-- - then +CHF 1.00 per started additional hour;
-- - CHF 5.90 maximum per started 24-hour period;
-- - CHF 30.00 guarantee/reservation reference;
-- - at 72 hours without return, CHF 30.00 contractual TOTAL.
--
-- This migration intentionally does not touch rental_sessions. Existing rental
-- pricing_snapshot values remain immutable and keep their historical semantics.

DO $preflight$
DECLARE
  v_member_count integer;
  v_premium_count integer;
BEGIN
  SELECT count(*) INTO v_member_count
  FROM public.price_profiles
  WHERE name = 'Chargeurs.ch Client' AND active = true;

  SELECT count(*) INTO v_premium_count
  FROM public.price_profiles
  WHERE name = 'chargeur.ch Premium' AND active = true;

  IF v_member_count <> 1 THEN
    RAISE EXCEPTION 'MEMBER_PRICING_V3_FINAL_MEMBER_PROFILE_COUNT_%', v_member_count;
  END IF;
  IF v_premium_count <> 1 THEN
    RAISE EXCEPTION 'MEMBER_PRICING_V3_FINAL_PREMIUM_PROFILE_COUNT_%', v_premium_count;
  END IF;
END
$preflight$;

-- The ordinary pricing engine computes initial_fee + started billable periods.
-- Encoding 100 + 60 included minutes + 100/60min with a 200 minimum yields:
-- 0..120 min = 200; 121..180 = 300; 181..240 = 400; 241..300 = 500;
-- >=301 min reaches the 590 daily cap for the rest of the first 24h.
UPDATE public.price_profiles
SET initial_fee_cents = 100,
    included_minutes = 60,
    period_minutes = 60,
    price_per_period_cents = 100,
    grace_minutes = 0,
    daily_cap_cents = 590,
    total_cap_cents = 3000,
    max_amount_cents = 3000,
    deposit_cents = 3000,
    late_fee_cents = 0,
    unreturned_fee_cents = 3000,
    unreturned_after_minutes = 4320,
    min_amount_cents = 200,
    rounding = 'none',
    tax_percent = 0,
    updated_at = now()
WHERE name = 'Chargeurs.ch Client'
  AND active = true;

DO $assertions$
DECLARE
  v_member uuid;
  v_premium uuid;
  v_bad integer;
  v_minutes integer;
  v_expected integer;
  v_snapshot jsonb;
  v_quote jsonb;
  v_wallet jsonb;
  v_start constant timestamptz := timestamptz '2026-08-27 00:00:00+00';
BEGIN
  SELECT id INTO v_member
  FROM public.price_profiles
  WHERE name = 'Chargeurs.ch Client' AND active = true;

  SELECT id INTO v_premium
  FROM public.price_profiles
  WHERE name = 'chargeur.ch Premium' AND active = true;

  IF NOT EXISTS (
    SELECT 1
    FROM public.price_profiles
    WHERE id = v_member
      AND initial_fee_cents = 100
      AND included_minutes = 60
      AND period_minutes = 60
      AND price_per_period_cents = 100
      AND grace_minutes = 0
      AND daily_cap_cents = 590
      AND min_amount_cents = 200
      AND deposit_cents = 3000
      AND unreturned_fee_cents = 3000
      AND unreturned_after_minutes = 4320
      AND total_cap_cents = 3000
      AND max_amount_cents = 3000
      AND rounding = 'none'
      AND tax_percent = 0
  ) THEN
    RAISE EXCEPTION 'MEMBER_PRICING_V3_FINAL_PROFILE_ASSERTION_FAILED';
  END IF;

  -- Express is explicitly outside this correction and must retain all four tiers.
  SELECT count(*) INTO v_bad
  FROM (VALUES (30,190),(120,390),(360,590),(1440,790)) expected(upper_minutes,total_cents)
  LEFT JOIN (
    SELECT upper_minutes,total_cents
    FROM public.price_profile_tiers
    WHERE price_profile_id = v_premium
  ) actual
    ON actual.upper_minutes = expected.upper_minutes
   AND actual.total_cents = expected.total_cents
  WHERE actual.upper_minutes IS NULL;

  IF v_bad <> 0 OR (
    SELECT count(*) FROM public.price_profile_tiers WHERE price_profile_id = v_premium
  ) <> 4 THEN
    RAISE EXCEPTION 'MEMBER_PRICING_V3_FINAL_EXPRESS_TIERS_CHANGED';
  END IF;

  -- All three pilot stations must still resolve both commercial segments.
  SELECT count(*) INTO v_bad
  FROM (VALUES ('DTA21269'),('DTA21277'),('DTA22032')) station(station_id)
  CROSS JOIN (VALUES ('guest'),('member')) seg(segment)
  LEFT JOIN public.customer_segment_price_profiles mapping
    ON mapping.station_id = station.station_id
   AND mapping.segment = seg.segment
   AND mapping.active = true
  WHERE mapping.price_profile_id IS NULL
     OR (seg.segment = 'guest' AND mapping.price_profile_id <> v_premium)
     OR (seg.segment = 'member' AND mapping.price_profile_id <> v_member);

  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'MEMBER_PRICING_V3_FINAL_SEGMENT_MAPPING_ASSERTION_FAILED';
  END IF;

  -- Validate the authoritative snapshot calculator at every commercial boundary.
  FOR v_minutes, v_expected IN
    SELECT * FROM (VALUES
      (0,200),(1,200),(30,200),(60,200),(61,200),(120,200),
      (121,300),(180,300),(181,400),(240,400),(241,500),(300,500),
      (301,590),(360,590),(1440,590),(1441,1180),(4319,1770),(4320,3000)
    ) AS expected(minutes, final_cents)
  LOOP
    v_snapshot := public.compute_customer_pricing_snapshot(
      'DTA21269', 'member', v_start,
      v_start + make_interval(mins => v_minutes),
      'active', 'normal', 'CHF'
    );
    IF coalesce((v_snapshot->>'pricing_rules_version')::integer, 0) <> 3
       OR coalesce((v_snapshot->>'final_cents')::integer, -1) <> v_expected THEN
      RAISE EXCEPTION 'MEMBER_PRICING_V3_FINAL_SNAPSHOT_VECTOR_%_EXPECTED_%_GOT_%',
        v_minutes, v_expected, v_snapshot->>'final_cents';
    END IF;
  END LOOP;

  IF coalesce((v_snapshot->>'non_return_total_applied')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'MEMBER_PRICING_V3_FINAL_72H_NON_RETURN_ASSERTION_FAILED';
  END IF;

  -- Validate the live Wallet calculator used by prepaid settlement from the same
  -- frozen quote, so UI/live state and final settlement cannot silently diverge.
  v_quote := public.compute_customer_pricing_snapshot(
    'DTA21269', 'member', v_start, NULL, 'created', 'normal', 'CHF'
  );

  FOR v_minutes, v_expected IN
    SELECT * FROM (VALUES
      (0,200),(1,200),(30,200),(60,200),(61,200),(120,200),
      (121,300),(180,300),(181,400),(240,400),(241,500),(300,500),
      (301,590),(360,590),(1440,590),(1441,1180),(4319,1770),(4320,3000)
    ) AS expected(minutes, final_cents)
  LOOP
    v_wallet := public.customer_wallet_pricing_state(
      v_quote, v_start, v_start + make_interval(mins => v_minutes)
    );
    IF v_wallet IS NULL
       OR coalesce((v_wallet->>'final_cents')::integer, -1) <> v_expected THEN
      RAISE EXCEPTION 'MEMBER_PRICING_V3_FINAL_WALLET_VECTOR_%_EXPECTED_%_GOT_%',
        v_minutes, v_expected, v_wallet->>'final_cents';
    END IF;
  END LOOP;

  IF coalesce((v_wallet->>'non_return_total_applied')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'MEMBER_PRICING_V3_FINAL_WALLET_72H_ASSERTION_FAILED';
  END IF;

  -- An explicit non-return outcome must use the same CHF 30 total even before 72h.
  v_snapshot := public.compute_customer_pricing_snapshot(
    'DTA21269', 'member', v_start, v_start + interval '2 hours',
    'active', 'not_returned', 'CHF'
  );
  IF coalesce((v_snapshot->>'final_cents')::integer, -1) <> 3000
     OR coalesce((v_snapshot->>'non_return_total_applied')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'MEMBER_PRICING_V3_FINAL_EXPLICIT_NON_RETURN_ASSERTION_FAILED';
  END IF;
END
$assertions$;
