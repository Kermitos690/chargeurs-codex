-- A customer may read records only after a verified-account Edge Function has
-- linked each rental to customer_user_id. Matching a mutable JWT email in an
-- RLS policy made the browser data path broader than the verified account
-- path. Legacy email rentals are claimed server-side by account-privacy.

DROP POLICY IF EXISTS "Customers read own rentals" ON public.rental_sessions;
CREATE POLICY "Customers read own rentals"
  ON public.rental_sessions FOR SELECT TO authenticated
  USING (customer_user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Customers read own payments" ON public.payments;
CREATE POLICY "Customers read own payments"
  ON public.payments FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.rental_sessions rs
      WHERE rs.id = payments.rental_session_id
        AND rs.customer_user_id = (SELECT auth.uid())
    )
  );
