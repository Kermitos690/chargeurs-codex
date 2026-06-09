CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

-- Remove any previous version of the job to keep this idempotent.
SELECT cron.unschedule('expire-stale-rental-sessions')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-stale-rental-sessions');

SELECT cron.schedule(
  'expire-stale-rental-sessions',
  '*/5 * * * *',
  $$SELECT public.expire_stale_rental_sessions();$$
);