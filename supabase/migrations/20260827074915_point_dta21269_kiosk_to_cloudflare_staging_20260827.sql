-- Keep the pilot station metadata aligned with the Cloudflare staging runtime.
-- Only DTA21269 is migrated; the other stations remain closed until qualified.

UPDATE public.stations
SET kiosk_url = 'https://chargeurs-ch-staging-cf.pages.dev/kiosk/DTA21269',
    updated_at = now()
WHERE station_id = 'DTA21269'
  AND environment = 'staging';
