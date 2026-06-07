-- 1. Lock down pricing internals: no anonymous/authenticated direct access.
REVOKE EXECUTE ON FUNCTION public.effective_price(text, text) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.compute_pricing(text, text, text, timestamptz, timestamptz, text, text, text) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.resolve_price_profile(text, text, text) FROM anon, authenticated, public;

-- 2. Kiosk token lifecycle columns.
ALTER TABLE public.kiosk_devices
  ADD COLUMN IF NOT EXISTS token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS token_revoked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS token_rotated_at timestamptz;

-- 3. Authenticated kiosk quote: token strictly bound to a station, no spoofing.
CREATE OR REPLACE FUNCTION public.kiosk_quote(p_token text, p_station text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_hash text;
  v_dev record;
BEGIN
  IF p_token IS NULL OR length(p_token) < 20 OR p_station IS NULL THEN
    RETURN jsonb_build_object('error', 'KIOSK_AUTH_REQUIRED');
  END IF;
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  SELECT * INTO v_dev FROM public.kiosk_devices
   WHERE token_hash = v_hash
     AND active = true
     AND token_revoked = false
     AND station_id = p_station
     AND (token_expires_at IS NULL OR token_expires_at > now())
   LIMIT 1;

  IF v_dev.id IS NULL THEN
    RETURN jsonb_build_object('error', 'KIOSK_AUTH_INVALID');
  END IF;

  UPDATE public.kiosk_devices SET last_seen_at = now() WHERE id = v_dev.id;

  -- Price is resolved for the bound station/device only.
  RETURN public.compute_pricing(v_dev.station_id, p_station, NULL, now(), NULL, 'quote', 'normal', NULL);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('error', SQLERRM);
END $$;

REVOKE EXECUTE ON FUNCTION public.kiosk_quote(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.kiosk_quote(text, text) TO anon, authenticated, service_role;

-- 4. Exclude test pricing data from production resolution.
UPDATE public.price_assignments SET active = false
 WHERE price_profile_id IN (
   'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000002'
 );
UPDATE public.price_profiles SET active = false, is_default = false
 WHERE id IN (
   'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000002'
 );