-- Chargeurs.ch controlled beta release gate.
--
-- Kiosk rentals are disabled by default. Enabling the setting is an explicit
-- operator action that must happen only after the settlement flow, ChargeNow
-- synchronization and real Stripe authorization have been validated.
--
-- The trigger also rejects stale price profiles. It protects every server path,
-- including service_role inserts, rather than relying only on the kiosk UI.

INSERT INTO public.kiosk_settings (key, value)
SELECT 'beta_rentals_enabled', '{"enabled": false}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM public.kiosk_settings WHERE key = 'beta_rentals_enabled'
);

CREATE OR REPLACE FUNCTION public.enforce_kiosk_beta_release_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled boolean := false;
  v_profile public.price_profiles%ROWTYPE;
BEGIN
  -- Only sessions created by a provisioned kiosk are governed by this first
  -- beta gate. Administrative reconciliation rows remain possible.
  IF NEW.kiosk_device_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT lower(COALESCE(value->>'enabled', 'false')) = 'true'
    INTO v_enabled
    FROM public.kiosk_settings
   WHERE key = 'beta_rentals_enabled'
   LIMIT 1;

  IF COALESCE(v_enabled, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'BETA_RENTALS_DISABLED' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.price_profile_id IS NULL THEN
    RAISE EXCEPTION 'PRICING_UNSAFE_CONFIGURATION' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_profile
    FROM public.price_profiles
   WHERE id = NEW.price_profile_id
   LIMIT 1;

  IF v_profile.id IS NULL
     OR v_profile.active IS NOT TRUE
     OR upper(COALESCE(v_profile.currency, '')) <> 'CHF'
     OR COALESCE(v_profile.initial_fee_cents, -1) <> 0
     OR COALESCE(v_profile.included_minutes, -1) <> 0
     OR COALESCE(v_profile.period_minutes, -1) <> 30
     OR COALESCE(v_profile.price_per_period_cents, -1) <> 75
     OR COALESCE(v_profile.daily_cap_cents, -1) <> 1800
     OR COALESCE(v_profile.deposit_cents, -1) <> 3000
     OR COALESCE(v_profile.unreturned_fee_cents, -1) <> 9900
     OR COALESCE(v_profile.max_amount_cents, -1) <> 9900
  THEN
    RAISE EXCEPTION 'PRICING_UNSAFE_CONFIGURATION' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_kiosk_beta_release_gate ON public.rental_sessions;
CREATE TRIGGER trg_kiosk_beta_release_gate
BEFORE INSERT OR UPDATE OF price_profile_id, kiosk_device_id
ON public.rental_sessions
FOR EACH ROW
EXECUTE FUNCTION public.enforce_kiosk_beta_release_gate();

COMMENT ON FUNCTION public.enforce_kiosk_beta_release_gate() IS
  'Fail-closed gate for controlled kiosk beta: explicit enablement and canonical CHF pricing required.';
