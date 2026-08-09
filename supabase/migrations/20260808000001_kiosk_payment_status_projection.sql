-- The scoped kiosk RPC is the only payment-status source exposed to a kiosk.
-- Include a bounded failure code so it can tell an expired QR from an actual
-- post-payment hardware block without exposing Checkout URLs or financial data.
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
    'failure_code', rs.failure_code,
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
GRANT EXECUTE ON FUNCTION public.kiosk_session_status(uuid, text) TO anon, authenticated, service_role;

-- Repair only legacy terminal projections. The payment and audit rows remain
-- untouched; the kiosk merely receives the truthful terminal presentation.
UPDATE public.rental_sessions
SET state = 'payment_expired'
WHERE state = 'needs_support'
  AND failure_code = 'CHECKOUT_EXPIRED';

UPDATE public.rental_sessions
SET state = 'payment_failed'
WHERE state = 'needs_support'
  AND failure_code IN ('ASYNC_PAYMENT_FAILED', 'PAYMENT_INTENT_FAILED');
