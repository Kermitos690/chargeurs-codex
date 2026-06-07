-- =====================================================================
-- Chargeurs.ch — automated DB test suite (pricing + security grants)
-- Run: psql -f supabase/tests/db-tests.sql
-- Pure read-only assertions. Creates NO data. Uses RAISE EXCEPTION on
-- failure so a non-zero psql exit code signals a failing suite.
-- =====================================================================
\set ON_ERROR_STOP on
DO $$
DECLARE
  v jsonb;
  c_quote int; c_1m int; c_30m int; c_60m int; c_2h int; c_24h int; c_48h int; c_7d int;
  v_curr text;
  n int;
BEGIN
  RAISE NOTICE '--- PRICING SIMULATIONS ---';

  -- Quote (upfront): initial + 1 prepaid period
  v := public.compute_pricing(NULL,'DTA21277',NULL, now(), NULL, 'quote','normal',NULL);
  c_quote := (v->>'final_cents')::int; v_curr := v->>'currency';
  IF c_quote <= 0 THEN RAISE EXCEPTION 'FAIL quote final_cents=% must be > 0', c_quote; END IF;
  IF v_curr <> 'CHF' THEN RAISE EXCEPTION 'FAIL currency=% expected CHF', v_curr; END IF;
  IF (v->>'final_cents') !~ '^[0-9]+$' THEN RAISE EXCEPTION 'FAIL final_cents not integer cents'; END IF;
  RAISE NOTICE 'PASS quote = % %', c_quote, v_curr;

  -- Duration ladder
  c_1m  := (public.compute_pricing(NULL,'DTA21277',NULL, now(), now()+interval '1 minute','active','normal',NULL)->>'final_cents')::int;
  c_30m := (public.compute_pricing(NULL,'DTA21277',NULL, now(), now()+interval '30 minutes','active','normal',NULL)->>'final_cents')::int;
  c_60m := (public.compute_pricing(NULL,'DTA21277',NULL, now(), now()+interval '60 minutes','active','normal',NULL)->>'final_cents')::int;
  c_2h  := (public.compute_pricing(NULL,'DTA21277',NULL, now(), now()+interval '2 hours','active','normal',NULL)->>'final_cents')::int;
  c_24h := (public.compute_pricing(NULL,'DTA21277',NULL, now(), now()+interval '24 hours','active','normal',NULL)->>'final_cents')::int;
  c_48h := (public.compute_pricing(NULL,'DTA21277',NULL, now(), now()+interval '48 hours','active','normal',NULL)->>'final_cents')::int;
  c_7d  := (public.compute_pricing(NULL,'DTA21277',NULL, now(), now()+interval '7 days','active','normal',NULL)->>'final_cents')::int;

  -- Monotonic non-decreasing with duration
  IF NOT (c_1m <= c_30m AND c_30m <= c_60m AND c_60m <= c_2h AND c_2h <= c_24h AND c_24h <= c_48h AND c_48h <= c_7d) THEN
    RAISE EXCEPTION 'FAIL pricing not monotonic: 1m=% 30m=% 60m=% 2h=% 24h=% 48h=% 7d=%', c_1m,c_30m,c_60m,c_2h,c_24h,c_48h,c_7d;
  END IF;
  RAISE NOTICE 'PASS monotonic ladder: 1m=% 30m=% 60m=% 2h=% 24h=% 48h=% 7d=%', c_1m,c_30m,c_60m,c_2h,c_24h,c_48h,c_7d;

  -- All amounts non-negative integers
  IF c_1m<0 OR c_30m<0 OR c_60m<0 OR c_24h<0 THEN RAISE EXCEPTION 'FAIL negative amount'; END IF;
  RAISE NOTICE 'PASS all amounts non-negative integer cents';

  -- not_returned penalty >= normal return
  IF (public.compute_pricing(NULL,'DTA21277',NULL, now(), now()+interval '2 hours','active','not_returned',NULL)->>'final_cents')::int < c_2h THEN
    RAISE EXCEPTION 'FAIL not_returned cheaper than normal';
  END IF;
  RAISE NOTICE 'PASS not_returned >= normal';

  -- Currency mismatch must raise
  BEGIN
    v := public.compute_pricing(NULL,'DTA21277',NULL, now(), NULL,'quote','normal','EUR');
    RAISE EXCEPTION 'FAIL currency mismatch not rejected';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%CURRENCY_MISMATCH%' AND SQLERRM NOT LIKE '%FAIL%' THEN
      RAISE NOTICE 'PASS currency mismatch rejected (%).', SQLERRM;
    ELSIF SQLERRM LIKE '%FAIL%' THEN RAISE; END IF;
  END;

  RAISE NOTICE '--- SECURITY GRANTS ---';
  IF has_function_privilege('anon', 'public.compute_pricing(text,text,text,timestamptz,timestamptz,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL anon can execute compute_pricing'; END IF;
  IF has_function_privilege('authenticated', 'public.compute_pricing(text,text,text,timestamptz,timestamptz,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL authenticated can execute compute_pricing'; END IF;
  IF has_function_privilege('anon', 'public.effective_price(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL anon can execute effective_price'; END IF;
  IF has_function_privilege('anon', 'public.has_role(uuid,app_role)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL anon can execute has_role'; END IF;
  IF NOT has_function_privilege('authenticated', 'public.has_role(uuid,app_role)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL authenticated cannot execute has_role (RLS would break)'; END IF;
  RAISE NOTICE 'PASS pricing/role function grants locked down';

  -- raw_data hidden from anon; availability visible
  IF has_column_privilege('anon','public.stations','raw_data','SELECT') THEN
    RAISE EXCEPTION 'FAIL anon can read stations.raw_data'; END IF;
  IF has_column_privilege('anon','public.slots','raw_data','SELECT') THEN
    RAISE EXCEPTION 'FAIL anon can read slots.raw_data'; END IF;
  IF has_column_privilege('anon','public.batteries','raw_data','SELECT') THEN
    RAISE EXCEPTION 'FAIL anon can read batteries.raw_data'; END IF;
  IF NOT has_column_privilege('anon','public.stations','online','SELECT') THEN
    RAISE EXCEPTION 'FAIL anon cannot read stations.online (kiosk would break)'; END IF;
  RAISE NOTICE 'PASS raw_data hidden from anon, availability columns readable';

  -- RLS enabled on all business-sensitive tables
  SELECT count(*) INTO n FROM pg_tables t
    WHERE schemaname='public'
      AND tablename IN ('rental_sessions','payments','refunds','kiosk_devices','user_roles',
                        'wallet_ledger','wallets','price_profiles','price_assignments',
                        'system_incidents','audit_logs','api_logs','webhook_events',
                        'chargenow_callbacks','cabinet_events','maintenance_actions')
      AND NOT rowsecurity;
  IF n > 0 THEN RAISE EXCEPTION 'FAIL % sensitive tables without RLS', n; END IF;
  RAISE NOTICE 'PASS RLS enabled on all sensitive tables';

  -- Sensitive tables must NOT be anon-readable
  IF has_table_privilege('anon','public.rental_sessions','SELECT') THEN RAISE EXCEPTION 'FAIL anon table-grant on rental_sessions'; END IF;
  IF has_table_privilege('anon','public.payments','SELECT') THEN RAISE EXCEPTION 'FAIL anon table-grant on payments'; END IF;
  IF has_table_privilege('anon','public.kiosk_devices','SELECT') THEN RAISE EXCEPTION 'FAIL anon table-grant on kiosk_devices'; END IF;
  RAISE NOTICE 'PASS anon has no grants on rental_sessions/payments/kiosk_devices';

  RAISE NOTICE '======================================================';
  RAISE NOTICE 'ALL DB TESTS PASSED';
  RAISE NOTICE '======================================================';
END $$;
