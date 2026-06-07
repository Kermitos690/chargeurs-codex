-- Restrict anonymous exposure of internal hardware raw_data and kiosk settings.

-- 1. stations / slots / batteries: anonymous kiosk clients may read only
--    operational columns. raw_data (vendor/internal payloads) is excluded.
REVOKE SELECT ON public.stations FROM anon;
REVOKE SELECT ON public.slots FROM anon;
REVOKE SELECT ON public.batteries FROM anon;

GRANT SELECT (id, station_id, cabinet_id, name, location_name, status, online,
              signal, rentable_count, returnable_count, total_count, currency,
              price_per_period, last_sync_at, created_at, updated_at, shop_id)
  ON public.stations TO anon;

GRANT SELECT (id, station_id, slot_num, status, battery_id, updated_at)
  ON public.slots TO anon;

GRANT SELECT (id, battery_id, station_id, slot_num, status, power_level, updated_at)
  ON public.batteries TO anon;

-- 2. kiosk_settings: contains operational configuration; restrict reads to
--    authenticated back-office users. Edge functions use the service role.
DROP POLICY IF EXISTS "Public read settings" ON public.kiosk_settings;
REVOKE SELECT ON public.kiosk_settings FROM anon;

CREATE POLICY "Authenticated read settings"
  ON public.kiosk_settings FOR SELECT
  TO authenticated
  USING (true);