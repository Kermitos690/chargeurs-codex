-- FIELD_DEPLOYMENT_RC1: rental state authority and physical-slot reservation.
--
-- This migration is additive. It intentionally does not alter historic rental
-- evidence. New constraints apply to future writes and make a stale kiosk poll
-- unable to regress a more advanced server state.

ALTER TABLE public.rental_sessions
  ADD COLUMN IF NOT EXISTS state_version bigint NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.rental_session_state_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_session_id uuid NOT NULL REFERENCES public.rental_sessions(id) ON DELETE RESTRICT,
  event_id text NOT NULL,
  expected_state_version bigint,
  target_state text NOT NULL,
  resulting_state_version bigint,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rental_session_id, event_id)
);

CREATE TABLE IF NOT EXISTS public.station_slot_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id text NOT NULL,
  slot_num integer NOT NULL CHECK (slot_num >= 1 AND slot_num <= 128),
  battery_id text,
  rental_session_id uuid NOT NULL UNIQUE REFERENCES public.rental_sessions(id) ON DELETE RESTRICT,
  state text NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved', 'consumed', 'released', 'expired', 'cancelled')),
  reserved_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  released_at timestamptz,
  release_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- PostgreSQL cannot express "active and not expired" in a partial unique index
-- because now() is volatile. The reservation RPC expires rows while holding an
-- advisory lock, then this index enforces exactly one currently-reserved slot.
CREATE UNIQUE INDEX IF NOT EXISTS station_slot_reservations_active_slot_key
  ON public.station_slot_reservations (station_id, slot_num)
  WHERE state = 'reserved';
CREATE INDEX IF NOT EXISTS station_slot_reservations_rental_idx
  ON public.station_slot_reservations (rental_session_id);
CREATE INDEX IF NOT EXISTS rental_session_state_events_rental_created_idx
  ON public.rental_session_state_events (rental_session_id, created_at);

ALTER TABLE public.rental_session_state_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.station_slot_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rental_session_state_events FROM PUBLIC;
REVOKE ALL ON public.station_slot_reservations FROM PUBLIC;
GRANT ALL ON public.rental_session_state_events TO service_role;
GRANT ALL ON public.station_slot_reservations TO service_role;

CREATE OR REPLACE FUNCTION public.rental_session_state_rank(p_state text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO public
AS $$
  SELECT CASE lower(coalesce(p_state, ''))
    WHEN 'created' THEN 10
    WHEN 'checkout_created' THEN 10
    WHEN 'payment_pending' THEN 10
    WHEN 'payment_succeeded' THEN 20
    WHEN 'paid' THEN 20
    WHEN 'authorized' THEN 20
    WHEN 'prepaid' THEN 20
    WHEN 'slot_reserved' THEN 25
    WHEN 'ejection_requested' THEN 30
    WHEN 'ejecting' THEN 30
    WHEN 'ejected' THEN 40
    WHEN 'ejection_confirmed' THEN 40
    WHEN 'battery_taken' THEN 40
    WHEN 'active_rental' THEN 40
    WHEN 'battery_returned' THEN 50
    WHEN 'return_detected' THEN 50
    WHEN 'closing_order' THEN 50
    WHEN 'settling' THEN 50
    WHEN 'closed' THEN 60
    WHEN 'completed' THEN 60
    WHEN 'refunded' THEN 60
    WHEN 'payment_failed' THEN 70
    WHEN 'payment_expired' THEN 70
    WHEN 'payment_cancelled' THEN 70
    WHEN 'cancelled' THEN 70
    WHEN 'eject_failed' THEN 80
    WHEN 'chargenow_failed' THEN 80
    WHEN 'settlement_failed' THEN 80
    WHEN 'manual_review' THEN 80
    WHEN 'needs_support' THEN 80
    WHEN 'failed' THEN 80
    ELSE 0
  END;
$$;

CREATE OR REPLACE FUNCTION public.rental_session_transition_allowed(p_from text, p_to text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO public
AS $$
  SELECT CASE
    WHEN lower(coalesce(p_from, '')) = lower(coalesce(p_to, '')) THEN true
    WHEN public.rental_session_state_rank(p_to) = 0 THEN false
    WHEN public.rental_session_state_rank(p_to) < public.rental_session_state_rank(p_from) THEN false
    -- Terminal financial/hardware exception states require explicit operator
    -- reconciliation rather than an automatic regression back into the flow.
    WHEN public.rental_session_state_rank(p_from) >= 60 THEN false
    ELSE true
  END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_rental_session_state_machine()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.state IS DISTINCT FROM OLD.state THEN
    IF NOT public.rental_session_transition_allowed(OLD.state, NEW.state) THEN
      RAISE EXCEPTION 'RENTAL_STATE_REGRESSION: % -> %', OLD.state, NEW.state
        USING ERRCODE = 'P0001';
    END IF;
    NEW.state_version := OLD.state_version + 1;
  ELSIF TG_OP = 'UPDATE' THEN
    -- The database owns this counter. Callers cannot forge an apparently newer
    -- response for a kiosk poll without an actual state transition.
    NEW.state_version := OLD.state_version;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rental_session_state_machine ON public.rental_sessions;
CREATE TRIGGER trg_rental_session_state_machine
  BEFORE UPDATE ON public.rental_sessions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_rental_session_state_machine();

CREATE OR REPLACE FUNCTION public.release_terminal_slot_reservation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO public
AS $$
BEGIN
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    UPDATE public.station_slot_reservations
    SET state = CASE
          WHEN NEW.state IN ('ejected', 'ejection_confirmed', 'battery_taken', 'active_rental') THEN 'consumed'
          ELSE 'released'
        END,
        released_at = now(),
        release_reason = NEW.state,
        updated_at = now()
    WHERE rental_session_id = NEW.id
      AND state = 'reserved'
      AND NEW.state IN (
        'ejected', 'ejection_confirmed', 'battery_taken', 'active_rental',
        'payment_failed', 'payment_expired', 'payment_cancelled', 'cancelled',
        'eject_failed', 'chargenow_failed', 'settlement_failed', 'manual_review',
        'needs_support', 'failed', 'closed', 'completed', 'refunded'
      );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_release_terminal_slot_reservation ON public.rental_sessions;
CREATE TRIGGER trg_release_terminal_slot_reservation
  AFTER UPDATE ON public.rental_sessions
  FOR EACH ROW EXECUTE FUNCTION public.release_terminal_slot_reservation();

-- Atomically creates the session and reserves the concrete physical slot.
-- The Edge Function supplies only server-derived pricing and a freshly-read,
-- eligible slot; no browser-provided amount or battery identity is trusted.
CREATE OR REPLACE FUNCTION public.create_reserved_kiosk_rental_session(
  p_session jsonb
)
RETURNS public.rental_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_station_id text := nullif(p_session->>'station_id', '');
  v_slot_num integer := nullif(p_session->>'selected_slot_num', '')::integer;
  v_battery_id text := nullif(p_session->>'battery_id', '');
  v_expires_at timestamptz := nullif(p_session->>'expires_at', '')::timestamptz;
  v_session public.rental_sessions;
BEGIN
  IF v_station_id IS NULL OR v_slot_num IS NULL OR v_slot_num < 1 OR v_expires_at IS NULL THEN
    RAISE EXCEPTION 'INVALID_SLOT_RESERVATION_PAYLOAD' USING ERRCODE = 'P0001';
  END IF;

  -- Serialize all competing selections of the same physical slot, including
  -- requests that race before an application-level idempotency lookup.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_station_id || ':' || v_slot_num::text, 0));

  UPDATE public.station_slot_reservations
  SET state = 'expired', released_at = now(), release_reason = 'reservation_ttl', updated_at = now()
  WHERE station_id = v_station_id
    AND slot_num = v_slot_num
    AND state = 'reserved'
    AND expires_at <= now();

  IF EXISTS (
    SELECT 1 FROM public.station_slot_reservations
    WHERE station_id = v_station_id AND slot_num = v_slot_num AND state = 'reserved'
  ) THEN
    RAISE EXCEPTION 'SLOT_ALREADY_RESERVED' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.rental_sessions (
    station_id, cabinet_id, shop_id, kiosk_device_id,
    price_profile_id, price_profile_version, pricing_snapshot, pricing_snapshot_hash,
    state, public_session_code, amount, amount_expected, currency,
    selected_slot_num, battery_id, customer_language, idempotency_key, expires_at
  ) VALUES (
    v_station_id,
    nullif(p_session->>'cabinet_id', ''),
    nullif(p_session->>'shop_id', ''),
    nullif(p_session->>'kiosk_device_id', ''),
    nullif(p_session->>'price_profile_id', ''),
    nullif(p_session->>'price_profile_version', '')::integer,
    coalesce(p_session->'pricing_snapshot', '{}'::jsonb),
    nullif(p_session->>'pricing_snapshot_hash', ''),
    'created',
    nullif(p_session->>'public_session_code', ''),
    nullif(p_session->>'amount', '')::numeric,
    nullif(p_session->>'amount_expected', '')::numeric,
    coalesce(nullif(p_session->>'currency', ''), 'CHF'),
    v_slot_num,
    v_battery_id,
    coalesce(nullif(p_session->>'customer_language', ''), 'fr'),
    nullif(p_session->>'idempotency_key', ''),
    v_expires_at
  ) RETURNING * INTO v_session;

  INSERT INTO public.station_slot_reservations (
    station_id, slot_num, battery_id, rental_session_id, state, expires_at
  ) VALUES (
    v_station_id, v_slot_num, v_battery_id, v_session.id, 'reserved', v_expires_at
  );

  RETURN v_session;
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_rental_session(
  p_session_id uuid,
  p_expected_state_version bigint,
  p_target_state text,
  p_event_id text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS public.rental_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_session public.rental_sessions;
  v_event_inserted boolean := false;
  v_event_row_count integer := 0;
BEGIN
  SELECT * INTO v_session FROM public.rental_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'RENTAL_SESSION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_session.state_version <> p_expected_state_version THEN
    RAISE EXCEPTION 'RENTAL_STATE_VERSION_CONFLICT' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.rental_session_transition_allowed(v_session.state, p_target_state) THEN
    RAISE EXCEPTION 'RENTAL_STATE_REGRESSION: % -> %', v_session.state, p_target_state USING ERRCODE = 'P0001';
  END IF;

  IF p_event_id IS NOT NULL AND length(trim(p_event_id)) > 0 THEN
    INSERT INTO public.rental_session_state_events (
      rental_session_id, event_id, expected_state_version, target_state, metadata
    ) VALUES (
      p_session_id, p_event_id, p_expected_state_version, p_target_state, coalesce(p_metadata, '{}'::jsonb)
    ) ON CONFLICT (rental_session_id, event_id) DO NOTHING;
    GET DIAGNOSTICS v_event_row_count = ROW_COUNT;
    v_event_inserted := v_event_row_count > 0;
    IF NOT v_event_inserted THEN
      RETURN v_session;
    END IF;
  END IF;

  UPDATE public.rental_sessions
  SET state = p_target_state
  WHERE id = p_session_id
    AND state_version = p_expected_state_version
  RETURNING * INTO v_session;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RENTAL_STATE_VERSION_CONFLICT' USING ERRCODE = 'P0001';
  END IF;

  IF p_event_id IS NOT NULL AND length(trim(p_event_id)) > 0 THEN
    UPDATE public.rental_session_state_events
    SET resulting_state_version = v_session.state_version
    WHERE rental_session_id = p_session_id AND event_id = p_event_id;
  END IF;
  RETURN v_session;
END;
$$;

REVOKE ALL ON FUNCTION public.create_reserved_kiosk_rental_session(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transition_rental_session(uuid, bigint, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_reserved_kiosk_rental_session(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.transition_rental_session(uuid, bigint, text, text, jsonb) TO service_role;

-- Kiosk polling may see only the bounded state projection and its monotone
-- version, never raw payment or provider credential data.
CREATE OR REPLACE FUNCTION public.kiosk_session_status(p_id uuid, p_code text)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO public
AS $function$
  SELECT jsonb_build_object(
    'state', rs.state,
    'state_version', rs.state_version,
    'updated_at', rs.updated_at,
    'selected_slot_num', rs.selected_slot_num,
    'checkout_url', rs.checkout_url,
    'public_session_code', rs.public_session_code,
    'checkout_url_expires_at', rs.checkout_url_expires_at,
    'failure_code', rs.failure_code,
    'failure_message', rs.failure_message
  )
  FROM public.rental_sessions rs
  WHERE rs.id = p_id
    AND rs.public_session_code IS NOT NULL
    AND p_code IS NOT NULL
    AND length(p_code) >= 4
    AND rs.public_session_code = p_code
$function$;
