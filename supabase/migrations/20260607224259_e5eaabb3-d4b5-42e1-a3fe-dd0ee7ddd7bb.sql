-- 1) Restrict anonymous reads to operational columns only (exclude raw_data & internal fields)
REVOKE SELECT ON public.stations FROM anon;
REVOKE SELECT ON public.slots FROM anon;
REVOKE SELECT ON public.batteries FROM anon;

GRANT SELECT (
  station_id, name, location_name, status, online,
  rentable_count, returnable_count, total_count, last_sync_at
) ON public.stations TO anon;

GRANT SELECT (
  station_id, slot_num, status, battery_id
) ON public.slots TO anon;

GRANT SELECT (
  battery_id, station_id, slot_num, status, power_level
) ON public.batteries TO anon;

-- 2) Lock kiosk_settings reads to admins only
DROP POLICY IF EXISTS "Authenticated read settings" ON public.kiosk_settings;
