-- Fail closed: a kiosk rental may only use the explicitly configured beta
-- station, staging environment and Stripe test mode. This complements the
-- existing pricing gate and prevents a global `enabled=true` from expanding
-- the pilot to another station.

CREATE OR REPLACE FUNCTION public.enforce_kiosk_beta_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_config jsonb;
  v_enabled boolean := false;
  v_station_id text := '';
  v_environment text := '';
  v_mode text := '';
  v_station_environment text := '';
BEGIN
  IF NEW.kiosk_device_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT value
    INTO v_config
    FROM public.kiosk_settings
   WHERE key = 'beta_rentals_enabled'
   LIMIT 1;

  v_enabled := lower(coalesce(v_config->>'enabled', 'false')) = 'true';
  v_station_id := trim(coalesce(v_config->>'station_id', ''));
  v_environment := lower(trim(coalesce(v_config->>'environment', '')));
  v_mode := lower(trim(coalesce(v_config->>'mode', '')));

  IF v_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'BETA_RENTALS_DISABLED' USING ERRCODE = 'P0001';
  END IF;

  IF v_station_id = '' OR NEW.station_id IS DISTINCT FROM v_station_id THEN
    RAISE EXCEPTION 'BETA_STATION_NOT_ENABLED' USING ERRCODE = 'P0001';
  END IF;

  SELECT lower(coalesce(environment, ''))
    INTO v_station_environment
    FROM public.stations
   WHERE station_id = NEW.station_id
   LIMIT 1;

  IF v_environment <> 'staging' OR coalesce(v_station_environment, '') <> v_environment THEN
    RAISE EXCEPTION 'BETA_ENVIRONMENT_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  IF v_mode <> 'stripe_test' THEN
    RAISE EXCEPTION 'BETA_PAYMENT_MODE_UNSAFE' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.enforce_kiosk_beta_scope() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_kiosk_beta_scope() TO service_role;

DROP TRIGGER IF EXISTS trg_kiosk_beta_scope ON public.rental_sessions;
CREATE TRIGGER trg_kiosk_beta_scope
BEFORE INSERT OR UPDATE OF price_profile_id, kiosk_device_id, customer_segment, station_id
ON public.rental_sessions
FOR EACH ROW
EXECUTE FUNCTION public.enforce_kiosk_beta_scope();
