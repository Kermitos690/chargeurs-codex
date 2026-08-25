-- Keep the kiosk release gate fail-closed while allowing the active
-- Chargeurs+ member price profile. The former gate still hard-coded the
-- retired 75 ct / 30 min member tariff, while the current active member plan
-- and mapped profile use an authoritative 80 ct / hour contract.
--
-- A change to only the plan or only the profile remains blocked: both must
-- agree on currency, effective hourly price and daily cap before a member
-- rental session can be created.

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
  v_member_plan_count integer := 0;
  v_member_currency text;
  v_member_hourly_cents integer;
  v_member_daily_cap_cents integer;
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
    SELECT count(*), min(currency), min(hourly_cents), min(daily_cap_cents)
      INTO v_member_plan_count, v_member_currency, v_member_hourly_cents, v_member_daily_cap_cents
      FROM public.customer_membership_plans
     WHERE code = 'client'
       AND active IS TRUE;

    IF v_member_plan_count <> 1
       OR upper(coalesce(v_member_currency, '')) <> 'CHF'
       OR coalesce(v_member_hourly_cents, 0) <= 0
       OR coalesce(v_member_daily_cap_cents, 0) <= 0
       OR coalesce(v_profile.period_minutes, 0) <= 0
       OR coalesce(v_profile.price_per_period_cents, 0) <= 0
       OR (v_profile.price_per_period_cents::bigint * 60)
            <> (v_member_hourly_cents::bigint * v_profile.period_minutes::bigint)
       OR coalesce(v_profile.daily_cap_cents, -1) <> v_member_daily_cap_cents
       OR coalesce(v_profile.total_cap_cents, -1) <> 3000
       OR coalesce(v_profile.deposit_cents, -1) <> 3000
       OR coalesce(v_profile.unreturned_fee_cents, -1) <> 630
       OR coalesce(v_profile.unreturned_after_minutes, -1) <> 4320
       OR coalesce(v_profile.max_amount_cents, -1) <> 3000
       OR coalesce(v_profile.grace_minutes, -1) <> 0
       OR coalesce(v_profile.late_fee_cents, -1) <> 0
       OR coalesce(v_profile.min_amount_cents, -1) < 0
       OR coalesce(v_profile.rounding, '') <> 'none'
       OR coalesce(v_profile.tax_percent, -1) <> 0
    THEN
      RAISE EXCEPTION 'PRICING_UNSAFE_CONFIGURATION' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
