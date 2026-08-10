CREATE OR REPLACE FUNCTION public.expire_stale_rental_sessions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  n integer := 0;
BEGIN
  WITH expired_sessions AS (
    UPDATE public.rental_sessions
       SET state = 'expired',
           cancelled_at = COALESCE(cancelled_at, now()),
           failure_code = 'SESSION_EXPIRED',
           failure_message = 'Session abandonnée avant paiement',
           updated_at = now()
     WHERE state IN ('created', 'checkout_created')
       AND paid_at IS NULL
       AND expires_at IS NOT NULL
       AND expires_at < now()
    RETURNING id
  ), released_reservations AS (
    UPDATE public.station_slot_reservations r
       SET state = 'released',
           released_at = COALESCE(r.released_at, now()),
           release_reason = COALESCE(r.release_reason, 'session_expired'),
           updated_at = now()
     WHERE r.state = 'reserved'
       AND (
         r.rental_session_id IN (SELECT id FROM expired_sessions)
         OR (
           r.expires_at < now()
           AND EXISTS (
             SELECT 1
               FROM public.rental_sessions s
              WHERE s.id = r.rental_session_id
                AND s.paid_at IS NULL
                AND s.state IN ('expired', 'payment_expired', 'created', 'checkout_created')
           )
         )
       )
    RETURNING r.id
  )
  SELECT count(*) INTO n FROM expired_sessions;

  RETURN n;
END
$function$;

REVOKE ALL ON FUNCTION public.expire_stale_rental_sessions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_stale_rental_sessions() TO service_role;
