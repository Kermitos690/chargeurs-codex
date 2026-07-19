\set ON_ERROR_STOP on

DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END;
$$;

CREATE TABLE public.rental_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  battery_id text,
  state text NOT NULL DEFAULT 'active_rental'
);

CREATE TABLE public.rental_orchestrator_snapshots (
  rental_id uuid PRIMARY KEY,
  state text NOT NULL DEFAULT 'active',
  version bigint NOT NULL DEFAULT 0
);

CREATE TABLE public.rental_orchestrator_external_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  external_event_id text NOT NULL,
  rental_id uuid REFERENCES public.rental_orchestrator_snapshots(rental_id) ON DELETE SET NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  processing_error text,
  attempt_count integer NOT NULL DEFAULT 0,
  UNIQUE (source, external_event_id)
);

\i supabase/migrations/20260715210000_chargenow_return_inbox.sql

DO $$
DECLARE
  v_rental uuid := gen_random_uuid();
  v_claim text;
BEGIN
  INSERT INTO public.rental_sessions (id, battery_id, state)
  VALUES (v_rental, 'BATTERY-001', 'active_rental');
  INSERT INTO public.rental_orchestrator_snapshots (rental_id, state)
  VALUES (v_rental, 'active');

  SELECT public.claim_rental_external_event(
    'chargenow', 'event-1', v_rental, 'return',
    '{"tradeNo":"T-1","batteryId":"BATTERY-001","stationId":"DTA21269","slotNum":2}'::jsonb,
    10
  ) INTO v_claim;
  IF v_claim <> 'claimed' THEN RAISE EXCEPTION 'Expected claimed, got %', v_claim; END IF;

  SELECT public.claim_rental_external_event(
    'chargenow', 'event-1', v_rental, 'return', '{}'::jsonb, 10
  ) INTO v_claim;
  IF v_claim <> 'in_progress' THEN RAISE EXCEPTION 'Expected in_progress, got %', v_claim; END IF;

  PERFORM public.finish_rental_external_event('chargenow', 'event-1', false, 'TEMPORARY_ERROR');
  SELECT public.claim_rental_external_event(
    'chargenow', 'event-1', v_rental, 'return', '{}'::jsonb, 10
  ) INTO v_claim;
  IF v_claim <> 'claimed' THEN RAISE EXCEPTION 'Expected retry claim, got %', v_claim; END IF;

  PERFORM public.finish_rental_external_event('chargenow', 'event-1', true, null);
  SELECT public.claim_rental_external_event(
    'chargenow', 'event-1', v_rental, 'return', '{}'::jsonb, 10
  ) INTO v_claim;
  IF v_claim <> 'duplicate' THEN RAISE EXCEPTION 'Expected duplicate, got %', v_claim; END IF;

  IF (SELECT attempt_count FROM public.rental_orchestrator_external_events
      WHERE source = 'chargenow' AND external_event_id = 'event-1') <> 2 THEN
    RAISE EXCEPTION 'Retry attempt count was not persisted';
  END IF;

  UPDATE public.rental_sessions
  SET return_station_id = 'DTA21269', returned_slot_num = 2, return_external_event_id = 'event-1'
  WHERE id = v_rental;

  IF EXISTS (
    SELECT 1 FROM public.rental_sessions
    WHERE id = v_rental AND (return_station_id IS NULL OR returned_slot_num IS NULL)
  ) THEN
    RAISE EXCEPTION 'Return correlation fields were not added';
  END IF;

  IF has_function_privilege('anon',
    'public.claim_rental_external_event(text,text,uuid,text,jsonb,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not execute claim_rental_external_event';
  END IF;
  IF NOT has_function_privilege('service_role',
    'public.claim_rental_external_event(text,text,uuid,text,jsonb,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role must execute claim_rental_external_event';
  END IF;
END;
$$;
