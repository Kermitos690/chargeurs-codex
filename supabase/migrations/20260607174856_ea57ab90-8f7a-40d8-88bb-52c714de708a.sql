-- 1. Remove the fully public read policy.
DROP POLICY IF EXISTS "Public read rental sessions" ON public.rental_sessions;

-- 2. Staff-only read access.
CREATE POLICY "Staff can read rental sessions"
ON public.rental_sessions
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'super_admin')
  OR public.has_role(auth.uid(), 'staff')
  OR public.has_role(auth.uid(), 'operator')
  OR public.has_role(auth.uid(), 'viewer')
);

-- 3. Stop broadcasting every rental_sessions row change to all subscribers.
ALTER PUBLICATION supabase_realtime DROP TABLE public.rental_sessions;

-- 4. Safe, minimal status accessor for the kiosk and the payment page.
--    Returns ONLY non-sensitive fields for a single session id — no Stripe
--    customer/payment-intent ids, no pricing snapshot, no enumeration.
CREATE OR REPLACE FUNCTION public.kiosk_session_status(p_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
$$;

REVOKE EXECUTE ON FUNCTION public.kiosk_session_status(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.kiosk_session_status(uuid) TO anon, authenticated, service_role;