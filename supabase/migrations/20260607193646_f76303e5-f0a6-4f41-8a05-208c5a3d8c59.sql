-- Harden session status access: require the public_session_code as a bearer
-- secret in addition to the session UUID. A guessable/shareable UUID alone is
-- no longer sufficient to read session state, checkout URL or codes.
DROP FUNCTION IF EXISTS public.kiosk_session_status(uuid);

CREATE OR REPLACE FUNCTION public.kiosk_session_status(p_id uuid, p_code text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'state', rs.state,
    'selected_slot_num', rs.selected_slot_num,
    'checkout_url', rs.checkout_url,
    'public_session_code', rs.public_session_code,
    'checkout_url_expires_at', rs.checkout_url_expires_at,
    'failure_message', rs.failure_message
  )
  FROM public.rental_sessions rs
  WHERE rs.id = p_id
    AND rs.public_session_code IS NOT NULL
    AND p_code IS NOT NULL
    AND length(p_code) >= 4
    AND rs.public_session_code = p_code
$function$;

REVOKE ALL ON FUNCTION public.kiosk_session_status(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kiosk_session_status(uuid, text) TO anon, authenticated;