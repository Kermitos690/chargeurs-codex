-- Issue #75 — Chargeurs.ch Pass/member pricing and kiosk beta gate.
--
-- Scope:
-- - preserve the approved Guest/Express and Member/Pass price profiles;
-- - map both segments deterministically for the three pilot DTA stations;
-- - make the kiosk beta gate segment-aware while remaining fail-closed;
-- - do not alter payment settlement, hardware, ejection or kiosk UX.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.price_profiles
    WHERE id = '002b500d-feb2-41a6-ad5f-b2fbf92d79a6'::uuid
      AND active = true
      AND upper(coalesce(currency, '')) = 'CHF'
      AND coalesce(initial_fee_cents, -1) = 0
      AND coalesce(included_minutes, -1) = 0
      AND coalesce(period_minutes, -1) = 30
      AND coalesce(price_per_period_cents, -1) = 75
      AND coalesce(daily_cap_cents, -1) = 1800
      AND coalesce(deposit_cents, -1) = 3000
      AND coalesce(unreturned_fee_cents, -1) = 9900
      AND coalesce(max_amount_cents, -1) = 9900
  ) THEN
    RAISE EXCEPTION 'PRICING_GUEST_PROFILE_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.price_profiles
    WHERE id = 'f43b1e63-8ac2-4dcb-b284-dfcc2d7006e6'::uuid
      AND active = true
      AND upper(coalesce(currency, '')) = 'CHF'
      AND coalesce(initial_fee_cents, -1) = 0
      AND coalesce(included_minutes, -1) = 0
      AND coalesce(period_minutes, -1) = 60
      AND coalesce(price_per_period_cents, -1) = 75
      AND coalesce(daily_cap_cents, -1) = 900
      AND coalesce(deposit_cents, -1) = 3000
      AND coalesce(unreturned_fee_cents, -1) = 9900
      AND coalesce(max_amount_cents, -1) = 9900
  ) THEN
    RAISE EXCEPTION 'PRICING_MEMBER_PROFILE_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

INSERT INTO public.customer_segment_price_profiles(station_id, segment, price_profile_id, active)
VALUES
  ('DTA21269', 'guest',  '002b500d-feb2-41a6-ad5f-b2fbf92d79a6'::uuid, true),
  ('DTA21269', 'member', 'f43b1e63-8ac2-4dcb-b284-dfcc2d7006e6'::uuid, true),
  ('DTA21277', 'guest',  '002b500d-feb2-41a6-ad5f-b2fbf92d79a6'::uuid, true),
  ('DTA21277', 'member', 'f43b1e63-8ac2-4dcb-b284-dfcc2d7006e6'::uuid, true),
  ('DTA22032', 'guest',  '002b500d-feb2-41a6-ad5f-b2fbf92d79a6'::uuid, true),
  ('DTA22032', 'member', 'f43b1e63-8ac2-4dcb-b284-dfcc2d7006e6'::uuid, true)
ON CONFLICT (station_id, segment) DO UPDATE
SET price_profile_id = EXCLUDED.price_profile_id,
    active = true,
    updated_at = now();

CREATE OR REPLACE FUNCTION public.enforce_kiosk_beta_release_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled boolean := false;
  v_segment text := coalesce(nullif(NEW.customer_segment, ''), 'guest');
  v_expected_profile_id uuid;
  v_profile public.price_profiles%ROWTYPE;
BEGIN
  -- Administrative reconciliation rows remain outside the controlled kiosk gate.
  IF NEW.kiosk_device_id IS NULL THEN
    RETURN NEW;
  END IF;

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

  -- Fail closed if the station/segment mapping is absent, inactive or if a
  -- caller tries to attach a different profile to the session.
  IF v_expected_profile_id IS NULL OR NEW.price_profile_id <> v_expected_profile_id THEN
    RAISE EXCEPTION 'PRICING_UNSAFE_CONFIGURATION' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_profile
    FROM public.price_profiles
   WHERE id = NEW.price_profile_id
   LIMIT 1;

  IF v_profile.id IS NULL
     OR v_profile.active IS NOT TRUE
     OR upper(coalesce(v_profile.currency, '')) <> 'CHF'
     OR coalesce(v_profile.initial_fee_cents, -1) <> 0
     OR coalesce(v_profile.included_minutes, -1) <> 0
     OR coalesce(v_profile.price_per_period_cents, -1) <> 75
     OR coalesce(v_profile.deposit_cents, -1) <> 3000
     OR coalesce(v_profile.unreturned_fee_cents, -1) <> 9900
     OR coalesce(v_profile.max_amount_cents, -1) <> 9900
     OR (
       v_segment = 'guest'
       AND (
         coalesce(v_profile.period_minutes, -1) <> 30
         OR coalesce(v_profile.daily_cap_cents, -1) <> 1800
       )
     )
     OR (
       v_segment = 'member'
       AND (
         coalesce(v_profile.period_minutes, -1) <> 60
         OR coalesce(v_profile.daily_cap_cents, -1) <> 900
       )
     )
  THEN
    RAISE EXCEPTION 'PRICING_UNSAFE_CONFIGURATION' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_kiosk_beta_release_gate() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_kiosk_beta_release_gate ON public.rental_sessions;
CREATE TRIGGER trg_kiosk_beta_release_gate
BEFORE INSERT OR UPDATE OF price_profile_id, kiosk_device_id, customer_segment, station_id
ON public.rental_sessions
FOR EACH ROW
EXECUTE FUNCTION public.enforce_kiosk_beta_release_gate();

COMMENT ON FUNCTION public.enforce_kiosk_beta_release_gate() IS
  'Fail-closed kiosk beta gate validating the station-resolved Guest or Member pricing contract.';
