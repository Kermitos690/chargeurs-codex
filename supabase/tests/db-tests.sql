-- =====================================================================
-- Chargeurs.ch — automated DB test suite (pricing + security grants)
-- Run: psql -f supabase/tests/db-tests.sql
-- Assertions are read-only except for transactional fixtures that are rolled
-- back by the included hardening tests. Uses RAISE EXCEPTION on failure so a
-- non-zero psql exit code signals a failing suite.
-- =====================================================================
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
  IF has_function_privilege('anon', 'public.api_quota_hit(uuid,integer,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.api_quota_hit(uuid,integer,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL browser role can execute api_quota_hit';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.api_quota_hit(uuid,integer,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL service_role cannot execute api_quota_hit';
  END IF;
  IF has_function_privilege('anon', 'public.enforce_kiosk_beta_release_gate()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.enforce_kiosk_beta_release_gate()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL browser role can execute trigger-only beta gate';
  END IF;
  IF has_function_privilege('anon', 'public.price_profile_record_version()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.price_profile_record_version()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL browser role can execute trigger-only pricing history writer';
  END IF;
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

  RAISE NOTICE '--- STAGING PILOT BASELINE ---';
  IF NOT EXISTS (
    SELECT 1
    FROM public.organizations
    WHERE slug = 'chargeurs-ch' AND legal_name = 'Chargeurs.ch' AND kind = 'platform'
  ) THEN RAISE EXCEPTION 'FAIL Chargeurs.ch organization missing'; END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.stations station
    JOIN public.organizations organization ON organization.id = station.organization_id
    WHERE station.station_id = 'DTA21269'
      AND station.environment = 'staging'
      AND station.is_pilot = true
      AND organization.slug = 'chargeurs-ch'
  ) THEN RAISE EXCEPTION 'FAIL staging pilot station is not organization-bound'; END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.price_profiles profile
    JOIN public.price_assignments assignment ON assignment.price_profile_id = profile.id
    WHERE profile.name = 'Chargeurs.ch Pilote'
      AND profile.currency = 'CHF'
      AND profile.period_minutes = 30
      AND profile.price_per_period_cents = 75
      AND profile.daily_cap_cents = 1800
      AND profile.deposit_cents = 3000
      AND profile.max_amount_cents = 9900
      AND profile.unreturned_fee_cents = 9900
      AND assignment.scope = 'station'
      AND assignment.scope_ref = 'DTA21269'
      AND assignment.active = true
  ) THEN RAISE EXCEPTION 'FAIL exact pilot pricing or assignment missing'; END IF;

  IF COALESCE((SELECT (value->>'enabled')::boolean FROM public.kiosk_settings WHERE key = 'simulation_mode'), true) THEN
    RAISE EXCEPTION 'FAIL staging simulation mode must be disabled';
  END IF;
  RAISE NOTICE 'PASS organization, pilot station and exact pricing baseline';

  RAISE NOTICE '======================================================';
  RAISE NOTICE 'CORE DB TESTS PASSED';
  RAISE NOTICE '======================================================';
END $$;

-- The client profile that the kiosk resolves must stay aligned with the one
-- active Chargeurs+ plan. The release trigger enforces this same relation
-- before accepting a member rental session.
DO $$
DECLARE
  v_profile public.price_profiles%ROWTYPE;
  v_plan_count integer;
  v_plan_currency text;
  v_plan_hourly_cents integer;
  v_plan_daily_cap_cents integer;
BEGIN
  SELECT p.*
    INTO v_profile
    FROM public.resolve_customer_price_profile('DTA21277', 'member') r
    JOIN public.price_profiles p ON p.id = r.profile_id
   LIMIT 1;

  SELECT count(*), min(currency), min(hourly_cents), min(daily_cap_cents)
    INTO v_plan_count, v_plan_currency, v_plan_hourly_cents, v_plan_daily_cap_cents
    FROM public.customer_membership_plans
   WHERE code = 'client'
     AND active IS TRUE;

  IF v_profile.id IS NULL
     OR v_plan_count <> 1
     OR upper(coalesce(v_plan_currency, '')) <> 'CHF'
     OR coalesce(v_profile.period_minutes, 0) <= 0
     OR coalesce(v_profile.price_per_period_cents, 0) <= 0
     OR coalesce(v_plan_hourly_cents, 0) <= 0
     OR (v_profile.price_per_period_cents::bigint * 60)
          <> (v_plan_hourly_cents::bigint * v_profile.period_minutes::bigint)
     OR coalesce(v_profile.daily_cap_cents, -1) <> v_plan_daily_cap_cents
  THEN
    RAISE EXCEPTION 'FAIL member price profile and Chargeurs+ plan are not aligned';
  END IF;
  RAISE NOTICE 'PASS member profile matches active Chargeurs+ plan';
END;
$$;

-- The membership-credit RPC returns an output column named currency. Its
-- ledger predicate must qualify the real table column so PostgreSQL cannot
-- confuse it with that output variable during settlement.
DO $$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO v_definition
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'apply_customer_membership_credit_to_rental'
   LIMIT 1;

  IF v_definition IS NULL
     OR position('ledger.currency = ''CHF''' IN v_definition) = 0
  THEN
    RAISE EXCEPTION 'FAIL membership-credit currency predicate is not qualified';
  END IF;
  RAISE NOTICE 'PASS membership-credit currency predicate is qualified';
END;
$$;

DO $$
DECLARE
  v_organization_id uuid;
  v_device_public_id uuid := gen_random_uuid();
  v_result jsonb;
  v_device_id uuid;
  v_pairing_id uuid;
BEGIN
  SELECT id INTO v_organization_id FROM public.organizations WHERE slug = 'chargeurs-ch';

  INSERT INTO public.kiosk_pairing_codes (
    station_id, organization_id, label, code_hash, expires_at
  ) VALUES (
    'DTA21269', v_organization_id, 'DB test', repeat('a', 64), now() + interval '15 minutes'
  ) RETURNING id INTO v_pairing_id;

  v_result := public.redeem_kiosk_pairing_code(
    repeat('a', 64), repeat('b', 64), v_device_public_id, 'db-test'
  );
  IF COALESCE((v_result->>'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL valid pairing code was not redeemed';
  END IF;

  v_device_id := (v_result->>'device_id')::uuid;
  IF NOT EXISTS (
    SELECT 1 FROM public.kiosk_devices
    WHERE id = v_device_id
      AND station_id = 'DTA21269'
      AND organization_id = v_organization_id
      AND device_public_id = v_device_public_id
      AND token_hash = repeat('b', 64)
  ) THEN RAISE EXCEPTION 'FAIL enrolled kiosk identity was not bound correctly'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.kiosk_pairing_codes
    WHERE id = v_pairing_id AND used_at IS NOT NULL AND used_by_device_id = v_device_id
  ) THEN RAISE EXCEPTION 'FAIL pairing code was not consumed atomically'; END IF;

  DELETE FROM public.audit_logs WHERE action = 'kiosk.enrollment.redeemed' AND target = v_device_id::text;
  DELETE FROM public.kiosk_pairing_codes WHERE id = v_pairing_id;
  DELETE FROM public.kiosk_devices WHERE id = v_device_id;
  RAISE NOTICE 'PASS one-time organization-bound kiosk enrollment';
END $$;
