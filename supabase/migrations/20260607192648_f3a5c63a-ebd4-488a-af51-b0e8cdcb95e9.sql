-- Defense-in-depth: anon (unauthenticated) must hold NO grants on business
-- tables. RLS already blocks anon (no anon policies), this removes the
-- redundant blanket grants so privileges match policies. Idempotent.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'rental_sessions','payments','refunds','kiosk_devices','user_roles',
    'wallet_ledger','wallets','wallet_topups','system_incidents','audit_logs',
    'api_logs','webhook_events','chargenow_callbacks','cabinet_events',
    'maintenance_actions','apifox_orders','price_profiles','price_assignments',
    'price_profile_versions','profiles','shops','api_coverage','kiosk_settings',
    'rental_events'
  ] LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
  END LOOP;
END $$;