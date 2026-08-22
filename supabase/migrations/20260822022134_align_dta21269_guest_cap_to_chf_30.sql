-- Keep all new DTA21269 guest rental amounts on a single round CHF 30.00
-- maximum. Existing rental snapshots are intentionally immutable and are not
-- modified by this migration.
DO $block$
DECLARE
  v_profile_id uuid;
  v_profile_count integer;
BEGIN
  SELECT count(*)
    INTO v_profile_count
    FROM public.customer_segment_price_profiles
   WHERE station_id = 'DTA21269'
     AND segment = 'guest'
     AND active IS TRUE;

  IF v_profile_count <> 1 THEN
    RAISE EXCEPTION 'DTA21269_GUEST_PROFILE_NOT_UNIQUE';
  END IF;

  SELECT price_profile_id
    INTO v_profile_id
    FROM public.customer_segment_price_profiles
   WHERE station_id = 'DTA21269'
     AND segment = 'guest'
     AND active IS TRUE;

  UPDATE public.price_profiles
     SET total_cap_cents = 3000,
         max_amount_cents = 3000,
         -- At the existing three-day non-return threshold, 23.70 + 6.30 = 30.00.
         unreturned_fee_cents = 630,
         updated_at = now()
   WHERE id = v_profile_id
     AND active IS TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DTA21269_GUEST_PROFILE_NOT_ACTIVE';
  END IF;
END;
$block$;

-- Keep the rental creation guard strict while changing only the sanctioned
-- round-cap values. This mirrors the deployed function, including its CHF 30
-- deposit requirement for the guest rail.
CREATE OR REPLACE FUNCTION public.enforce_kiosk_beta_release_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_enabled boolean := false;
  v_segment text := coalesce(nullif(NEW.customer_segment, ''), 'guest');
  v_expected_profile_id uuid;
  v_profile public.price_profiles%ROWTYPE;
  v_tier_count integer := 0;
  v_expected_tier_count integer := 0;
BEGIN
  IF NEW.kiosk_device_id IS NULL THEN RETURN NEW; END IF;

  SELECT lower(coalesce(value->>'enabled', 'false')) = 'true'
    INTO v_enabled
    FROM public.kiosk_settings
   WHERE key = 'beta_rentals_enabled'
   LIMIT 1;

  IF coalesce(v_enabled, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'BETA_RENTALS_DISABLED' USING ERRCODE = 'P0001';
  END IF;

  IF v_segment NOT IN ('guest', 'member') OR NEW.price_profile_id IS NULL THEN
    RAISE EXCEPTION 'PRICING_UNSAFE_CONFIGURATION' USING ERRCODE = 'P0001';
  END IF;

  SELECT r.profile_id
    INTO v_expected_profile_id
    FROM public.resolve_customer_price_profile(NEW.station_id, v_segment) r
   LIMIT 1;

  IF v_expected_profile_id IS NULL OR NEW.price_profile_id <> v_expected_profile_id THEN
    RAISE EXCEPTION 'PRICING_UNSAFE_CONFIGURATION' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
    INTO v_profile
    FROM public.price_profiles
   WHERE id = NEW.price_profile_id
   LIMIT 1;

  IF v_profile.id IS NULL
     OR v_profile.active IS NOT TRUE
     OR upper(coalesce(v_profile.currency, '')) <> 'CHF'
     OR coalesce(v_profile.initial_fee_cents, -1) <> 0
     OR coalesce(v_profile.included_minutes, -1) <> 0
  THEN
    RAISE EXCEPTION 'PRICING_UNSAFE_CONFIGURATION' USING ERRCODE = 'P0001';
  END IF;

  IF v_segment = 'guest' THEN
    SELECT count(*),
           count(*) FILTER (
             WHERE (upper_minutes, total_cents) IN (
               (30, 190),
               (120, 390),
               (360, 590),
               (1440, 790)
             )
           )
      INTO v_tier_count, v_expected_tier_count
      FROM public.price_profile_tiers
     WHERE price_profile_id = v_profile.id;

    IF coalesce(v_profile.period_minutes, -1) <> 1440
       OR coalesce(v_profile.price_per_period_cents, -1) <> 790
       OR coalesce(v_profile.daily_cap_cents, -1) <> 0
       OR coalesce(v_profile.total_cap_cents, -1) <> 3000
       OR coalesce(v_profile.deposit_cents, -1) <> 3000
       OR coalesce(v_profile.unreturned_fee_cents, -1) <> 630
       OR coalesce(v_profile.unreturned_after_minutes, -1) <> 4320
       OR coalesce(v_profile.max_amount_cents, -1) <> 3000
       OR coalesce(v_profile.grace_minutes, -1) <> 0
       OR coalesce(v_profile.late_fee_cents, -1) <> 0
       OR coalesce(v_profile.min_amount_cents, -1) <> 0
       OR coalesce(v_profile.rounding, '') <> 'none'
       OR coalesce(v_profile.tax_percent, -1) <> 0
       OR v_tier_count <> 4
       OR v_expected_tier_count <> 4
    THEN
      RAISE EXCEPTION 'PRICING_UNSAFE_CONFIGURATION' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    IF coalesce(v_profile.price_per_period_cents, -1) <> 75
       OR coalesce(v_profile.deposit_cents, -1) <> 3000
       OR coalesce(v_profile.unreturned_fee_cents, -1) <> 9900
       OR coalesce(v_profile.max_amount_cents, -1) <> 9900
       OR coalesce(v_profile.period_minutes, -1) <> 60
       OR coalesce(v_profile.daily_cap_cents, -1) <> 900
    THEN
      RAISE EXCEPTION 'PRICING_UNSAFE_CONFIGURATION' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
