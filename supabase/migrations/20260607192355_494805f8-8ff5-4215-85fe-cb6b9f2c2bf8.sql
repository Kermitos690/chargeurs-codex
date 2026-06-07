-- =====================================================================
-- Security hardening (additive, idempotent) — pre-manual release gate
-- 1. Pricing RPCs must never be callable from the public Data API.
--    They run only inside SECURITY DEFINER wrappers or via service_role.
-- 2. has_role must not be enumerable by anonymous callers.
-- 3. Internal ChargeNow hardware payloads (raw_data) must not be exposed
--    to anonymous (public) reads on stations/slots/batteries.
-- =====================================================================

-- 1. Lock down pricing helper functions (service_role / definer-only use)
REVOKE EXECUTE ON FUNCTION public.compute_pricing(text, text, text, timestamptz, timestamptz, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.resolve_price_profile(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.effective_price(text, text) FROM PUBLIC, anon, authenticated;

-- 2. has_role: keep available to authenticated (needed by RLS policies),
--    remove anonymous enumeration surface.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;

-- 3. Hide raw_data from anonymous reads via column-scoped grants.
--    Anonymous (kiosk pages) only need operational availability columns.
--    Authenticated back-office keeps full access (RLS gates writes by admin).
REVOKE ALL ON public.stations FROM anon;
REVOKE ALL ON public.slots FROM anon;
REVOKE ALL ON public.batteries FROM anon;

GRANT SELECT (id, station_id, cabinet_id, name, location_name, status, online,
              signal, rentable_count, returnable_count, total_count, currency,
              price_per_period, last_sync_at, created_at, updated_at, shop_id)
  ON public.stations TO anon;

GRANT SELECT (id, station_id, slot_num, status, battery_id, updated_at)
  ON public.slots TO anon;

GRANT SELECT (id, battery_id, station_id, slot_num, status, power_level, updated_at)
  ON public.batteries TO anon;