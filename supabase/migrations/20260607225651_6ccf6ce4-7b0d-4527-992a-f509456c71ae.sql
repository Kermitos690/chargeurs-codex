ALTER TABLE public.rental_sessions
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS rental_sessions_idempotency_key_uidx
  ON public.rental_sessions (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS rental_sessions_device_station_created_idx
  ON public.rental_sessions (kiosk_device_id, station_id, created_at);

CREATE OR REPLACE FUNCTION public.expire_stale_rental_sessions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  UPDATE public.rental_sessions
     SET state = 'expired',
         cancelled_at = now(),
         failure_code = 'SESSION_EXPIRED',
         failure_message = 'Session abandonnée avant paiement',
         updated_at = now()
   WHERE state IN ('created', 'checkout_created')
     AND paid_at IS NULL
     AND expires_at IS NOT NULL
     AND expires_at < now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.expire_stale_rental_sessions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_rental_sessions() TO service_role;