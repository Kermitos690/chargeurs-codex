ALTER TABLE public.rental_sessions
  ADD COLUMN IF NOT EXISTS customer_email text,
  ADD COLUMN IF NOT EXISTS customer_user_id uuid;

CREATE INDEX IF NOT EXISTS idx_rental_sessions_customer_email
  ON public.rental_sessions (lower(customer_email));

DROP POLICY IF EXISTS "Customers read own rentals" ON public.rental_sessions;
CREATE POLICY "Customers read own rentals"
  ON public.rental_sessions
  FOR SELECT
  TO authenticated
  USING (
    customer_email IS NOT NULL
    AND lower(customer_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

DROP POLICY IF EXISTS "Customers read own payments" ON public.payments;
CREATE POLICY "Customers read own payments"
  ON public.payments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.rental_sessions rs
      WHERE rs.id = payments.rental_session_id
        AND rs.customer_email IS NOT NULL
        AND lower(rs.customer_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  );
