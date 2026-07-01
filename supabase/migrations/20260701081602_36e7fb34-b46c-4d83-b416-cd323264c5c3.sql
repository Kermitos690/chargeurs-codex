-- 1. Column-level lockdown for anon on stations (hide internal columns)
REVOKE SELECT ON public.stations FROM anon;
GRANT SELECT (id, station_id, name, location_name, status, online,
              rentable_count, returnable_count, total_count, currency,
              price_per_period, last_sync_at, created_at, updated_at,
              shop_id, partner_id) ON public.stations TO anon;

-- 2. Column-level lockdown for anon on slots (hide raw_data)
REVOKE SELECT ON public.slots FROM anon;
GRANT SELECT (id, station_id, slot_num, status, battery_id, updated_at)
  ON public.slots TO anon;

-- 3. Column-level lockdown for anon on batteries (hide raw_data)
REVOKE SELECT ON public.batteries FROM anon;
GRANT SELECT (id, battery_id, station_id, slot_num, status, power_level, updated_at)
  ON public.batteries TO anon;

-- 4. Remove public EXECUTE on internal SECURITY DEFINER functions
REVOKE EXECUTE ON FUNCTION public.effective_price(text, text) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.expire_stale_rental_sessions() FROM anon, authenticated, PUBLIC;

-- 5. Strengthen customer ownership: allow linked account OR verified email match
DROP POLICY IF EXISTS "Customers read own rentals" ON public.rental_sessions;
CREATE POLICY "Customers read own rentals"
  ON public.rental_sessions FOR SELECT TO authenticated
  USING (
    (customer_user_id IS NOT NULL AND customer_user_id = auth.uid())
    OR (customer_email IS NOT NULL
        AND lower(customer_email) = lower(COALESCE((auth.jwt() ->> 'email'), '')))
  );

DROP POLICY IF EXISTS "Customers read own payments" ON public.payments;
CREATE POLICY "Customers read own payments"
  ON public.payments FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.rental_sessions rs
    WHERE rs.id = payments.rental_session_id
      AND (
        (rs.customer_user_id IS NOT NULL AND rs.customer_user_id = auth.uid())
        OR (rs.customer_email IS NOT NULL
            AND lower(rs.customer_email) = lower(COALESCE((auth.jwt() ->> 'email'), '')))
      )
  ));
