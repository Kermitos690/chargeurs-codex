-- FIELD_DEPLOYMENT_RC1 P0: persist the intent before any supplier mutation.
--
-- This migration is additive and deliberately preserves historical rental,
-- payment and provider evidence. A provider HTTP response is not evidence of
-- a physical ejection: only a matching callback/reconciliation may confirm a
-- hardware command.

ALTER TABLE public.rental_sessions
  ADD COLUMN IF NOT EXISTS settlement_next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS settlement_last_attempt_at timestamptz;

CREATE TABLE IF NOT EXISTS public.hardware_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_session_id uuid NOT NULL REFERENCES public.rental_sessions(id) ON DELETE RESTRICT,
  station_id text NOT NULL,
  slot_num integer NOT NULL CHECK (slot_num >= 1 AND slot_num <= 128),
  command_type text NOT NULL CHECK (command_type IN ('eject')),
  idempotency_key text NOT NULL,
  state text NOT NULL DEFAULT 'prepared' CHECK (state IN (
    'prepared', 'dispatching', 'provider_acknowledged',
    'confirmation_pending', 'physically_confirmed', 'physical_ambiguity',
    'unknown_provider_result', 'failed', 'cancelled'
  )),
  provider_trade_no text,
  provider_order_id text,
  request_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  dispatch_started_at timestamptz,
  provider_acknowledged_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rental_session_id, command_type),
  UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS hardware_commands_station_state_idx
  ON public.hardware_commands (station_id, state, created_at DESC);
CREATE INDEX IF NOT EXISTS hardware_commands_trade_no_idx
  ON public.hardware_commands (provider_trade_no)
  WHERE provider_trade_no IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.rental_return_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_session_id uuid NOT NULL REFERENCES public.rental_sessions(id) ON DELETE RESTRICT,
  dedup_key text NOT NULL,
  battery_id text NOT NULL,
  station_id text NOT NULL,
  slot_num integer NOT NULL CHECK (slot_num >= 1 AND slot_num <= 128),
  provider_trade_no text,
  provider_event_id text,
  observed_at timestamptz NOT NULL,
  provider_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  settlement_triggered_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dedup_key)
);

CREATE INDEX IF NOT EXISTS rental_return_events_rental_idx
  ON public.rental_return_events (rental_session_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS rental_return_events_battery_idx
  ON public.rental_return_events (battery_id, observed_at DESC);

ALTER TABLE public.hardware_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_return_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hardware_commands FROM PUBLIC;
REVOKE ALL ON public.rental_return_events FROM PUBLIC;
GRANT ALL ON public.hardware_commands TO service_role;
GRANT ALL ON public.rental_return_events TO service_role;

-- A failed settlement must not be retried by every kiosk/provider poll. The
-- same atomic claim remains the sole financial worker gate, now respecting a
-- durable backoff timestamp written by the settlement runtime.
CREATE OR REPLACE FUNCTION public.claim_rental_settlement(
  p_rental_id uuid,
  p_lock_ttl_minutes integer default 10
)
RETURNS public.rental_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_session public.rental_sessions;
BEGIN
  IF p_lock_ttl_minutes < 1 OR p_lock_ttl_minutes > 120 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_LOCK_TTL';
  END IF;

  UPDATE public.rental_sessions
  SET settlement_status = 'settling',
      settlement_locked_at = now(),
      settlement_last_attempt_at = now(),
      settlement_attempts = COALESCE(settlement_attempts, 0) + 1
  WHERE id = p_rental_id
    AND settlement_status <> 'settled'
    AND (settlement_next_attempt_at IS NULL OR settlement_next_attempt_at <= now())
    AND (
      settlement_locked_at IS NULL
      OR settlement_locked_at < now() - make_interval(mins => p_lock_ttl_minutes)
    )
    AND settlement_status IN (
      'pending','authorized','prepaid','settling','failed','supplemental_required'
    )
  RETURNING * INTO v_session;

  RETURN v_session;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_rental_settlement(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_rental_settlement(uuid, integer) TO service_role;

COMMENT ON TABLE public.hardware_commands IS
  'Exactly-once hardware intents. Inserted before any supplier order/eject call; a timeout is reconciled, never automatically replayed.';
COMMENT ON TABLE public.rental_return_events IS
  'Deduplicated physical-return evidence. Callback delivery retries cannot trigger a second settlement.';
COMMENT ON COLUMN public.rental_sessions.settlement_next_attempt_at IS
  'Server-owned financial retry backoff. Kiosk polling must not bypass it.';
