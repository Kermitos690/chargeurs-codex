\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.kiosk_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  value jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.price_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  active boolean NOT NULL DEFAULT true,
  currency text NOT NULL DEFAULT 'CHF',
  initial_fee_cents integer NOT NULL DEFAULT 0,
  included_minutes integer NOT NULL DEFAULT 0,
  period_minutes integer NOT NULL DEFAULT 30,
  price_per_period_cents integer NOT NULL DEFAULT 0,
  daily_cap_cents integer NOT NULL DEFAULT 0,
  deposit_cents integer NOT NULL DEFAULT 0,
  unreturned_fee_cents integer NOT NULL DEFAULT 0,
  max_amount_cents integer NOT NULL DEFAULT 0
);

CREATE TABLE public.rental_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kiosk_device_id uuid,
  price_profile_id uuid
);

\i supabase/migrations/20260715170500_kiosk_beta_release_gate.sql

DO $$
DECLARE
  v_legacy uuid;
  v_valid uuid;
BEGIN
  INSERT INTO public.price_profiles (
    price_per_period_cents, daily_cap_cents, deposit_cents,
    unreturned_fee_cents, max_amount_cents
  ) VALUES (50, 0, 0, 0, 0)
  RETURNING id INTO v_legacy;

  BEGIN
    INSERT INTO public.rental_sessions (kiosk_device_id, price_profile_id)
    VALUES (gen_random_uuid(), v_legacy);
    RAISE EXCEPTION 'TEST_EXPECTED_DISABLED_FAILURE_NOT_RAISED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'TEST_EXPECTED_DISABLED_FAILURE_NOT_RAISED' THEN RAISE; END IF;
    IF SQLERRM <> 'BETA_RENTALS_DISABLED' THEN
      RAISE EXCEPTION 'Unexpected disabled-gate error: %', SQLERRM;
    END IF;
  END;

  UPDATE public.kiosk_settings
     SET value = '{"enabled": true}'::jsonb
   WHERE key = 'beta_rentals_enabled';

  BEGIN
    INSERT INTO public.rental_sessions (kiosk_device_id, price_profile_id)
    VALUES (gen_random_uuid(), v_legacy);
    RAISE EXCEPTION 'TEST_EXPECTED_PRICING_FAILURE_NOT_RAISED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'TEST_EXPECTED_PRICING_FAILURE_NOT_RAISED' THEN RAISE; END IF;
    IF SQLERRM <> 'PRICING_UNSAFE_CONFIGURATION' THEN
      RAISE EXCEPTION 'Unexpected pricing-gate error: %', SQLERRM;
    END IF;
  END;

  INSERT INTO public.price_profiles (
    active, currency, initial_fee_cents, included_minutes, period_minutes,
    price_per_period_cents, daily_cap_cents, deposit_cents,
    unreturned_fee_cents, max_amount_cents
  ) VALUES (
    true, 'CHF', 0, 0, 30,
    75, 1800, 3000,
    9900, 9900
  ) RETURNING id INTO v_valid;

  INSERT INTO public.rental_sessions (kiosk_device_id, price_profile_id)
  VALUES (gen_random_uuid(), v_valid);

  IF (SELECT count(*) FROM public.rental_sessions WHERE price_profile_id = v_valid) <> 1 THEN
    RAISE EXCEPTION 'Valid beta profile was not accepted';
  END IF;

  -- Non-kiosk administrative reconciliation rows remain possible while the
  -- beta gate is disabled or the profile is absent.
  UPDATE public.kiosk_settings
     SET value = '{"enabled": false}'::jsonb
   WHERE key = 'beta_rentals_enabled';
  INSERT INTO public.rental_sessions (kiosk_device_id, price_profile_id)
  VALUES (NULL, NULL);
END;
$$;
