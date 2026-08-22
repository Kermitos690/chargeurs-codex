// Stripe Terminal TEST backend for WisePad 3.
// Reader connectivity is rental-free; financial actions require a canonical rental.
// QR Checkout remains a parallel first-class rail. No pricing/ejection/return semantics are redefined here.
import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  canonicalRail,
  canonicalTerminalAmountCents,
  canonicalTerminalCurrency,
  requireStripeTestKey,
  stripeIntentSafelyCancelable,
  terminalBindingUsable,
  terminalIntentIdempotencyKey,
  terminalRailState,
} from "../_shared/stripeTerminalTest.ts";

const headers = {
  ...corsHeaders,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-kiosk-token, x-idempotency-key",
  "Access-Control-Expose-Headers": "x-correlation-id",
};

const admin = () => createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

async function sha256(input: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function kioskAuth(req: Request, db: any, stationId: string) {
  const token = (req.headers.get("X-Kiosk-Token") ?? "").trim();
  if (token.length < 24 || !stationId) return null;
  const hash = await sha256(token);
  const { data } = await db.from("kiosk_devices")
    .select("id,station_id,active,token_revoked,token_expires_at")
    .eq("token_hash", hash)
    .maybeSingle();
  if (!data || data.station_id !== stationId || !data.active || data.token_revoked) return null;
  if (data.token_expires_at && Date.parse(data.token_expires_at) < Date.now()) return null;
  return data;
}

function stripeClient(secretKey: string) {
  return new Stripe(secretKey, {
    apiVersion: "2025-09-30.clover" as any,
    httpClient: Stripe.createFetchHttpClient(),
  });
}

async function bindingForStation(db: any, stationId: string) {
  const { data, error } = await db.from("stripe_terminal_station_bindings")
    .select("station_id,stripe_location_id,stripe_reader_id,environment,enabled")
    .eq("station_id", stationId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function loadRentalContext(req: Request, db: any, rentalSessionId: string) {
  if (!rentalSessionId) return { error: "MISSING_SESSION", status: 400 } as const;
  const { data: session, error } = await db.from("rental_sessions").select("*").eq("id", rentalSessionId).maybeSingle();
  if (error) throw error;
  if (!session) return { error: "SESSION_NOT_FOUND", status: 404 } as const;
  const stationId = String(session.station_id ?? "");
  const device = await kioskAuth(req, db, stationId);
  if (!device) return { error: "KIOSK_AUTH_INVALID", status: 401 } as const;
  if (String(session.kiosk_device_id ?? "") !== String(device.id)) return { error: "KIOSK_DEVICE_MISMATCH", status: 403 } as const;
  return { session, stationId, device } as const;
}

async function loadClaimAndAttempt(db: any, rentalSessionId: string) {
  const [{ data: claim, error: claimError }, { data: attempt, error: attemptError }] = await Promise.all([
    db.from("rental_payment_rail_claims")
      .select("rail,claim_state,claimed_at,released_at,release_reason,correlation_id")
      .eq("rental_session_id", rentalSessionId).maybeSingle(),
    db.from("stripe_terminal_payment_attempts")
      .select("*").eq("rental_session_id", rentalSessionId).maybeSingle(),
  ]);
  if (claimError) throw claimError;
  if (attemptError) throw attemptError;
  return { claim, attempt };
}

async function projectState(db: any, stripe: Stripe, session: any, reconcile: boolean) {
  const { claim, attempt } = await loadClaimAndAttempt(db, String(session.id));
  let stripeStatus = attempt?.status ?? null;
  const intentId = attempt?.stripe_payment_intent_id ?? null;

  if (reconcile && intentId) {
    const intent = await stripe.paymentIntents.retrieve(String(intentId));
    stripeStatus = intent.status;
    const update: Record<string, unknown> = {
      status: intent.status,
      last_reconciled_at: new Date().toISOString(),
      reconciliation_required: false,
      last_error: intent.last_payment_error?.message?.slice(0, 500) ?? null,
      updated_at: new Date().toISOString(),
    };
    if (intent.status === "canceled") update.canceled_at = new Date().toISOString();
    await db.from("stripe_terminal_payment_attempts").update(update).eq("rental_session_id", session.id);
    if (intent.status === "canceled") {
      await db.rpc("release_rental_payment_rail_claim", {
        p_rental_id: session.id,
        p_expected_rail: "stripe_terminal",
        p_reason: "stripe_confirmed_canceled",
      });
    }
  }

  const refreshed = await loadClaimAndAttempt(db, String(session.id));
  const rail = canonicalRail(refreshed.claim?.rail, refreshed.claim?.claim_state);
  const railState = terminalRailState(refreshed.attempt?.status ?? stripeStatus, refreshed.claim?.claim_state);
  return {
    rail,
    railState,
    serverConfirmed: Boolean(session.paid_at),
    paymentIntentId: refreshed.attempt?.stripe_payment_intent_id ?? intentId,
    stripeStatus: refreshed.attempt?.status ?? stripeStatus,
    recoveryRequired: refreshed.claim?.claim_state === "reconciliation_required" || Boolean(refreshed.attempt?.reconciliation_required),
    locationId: refreshed.attempt?.stripe_location_id ?? null,
    expectedReaderId: refreshed.attempt?.stripe_reader_id ?? null,
    attemptGeneration: refreshed.attempt?.attempt_generation ?? null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  const correlationId = crypto.randomUUID();
  const json = (body: Record<string, unknown>, status = 200) => new Response(
    JSON.stringify({ ...body, correlationId }),
    { status, headers: { ...headers, "Content-Type": "application/json", "X-Correlation-Id": correlationId } },
  );
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const db = admin();
  let rentalSessionId = "";
  let terminalClaimed = false;
  let stripeCallStarted = false;
  let createdIntentId: string | null = null;

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "";
    const allowed = [
      "connection_token",
      "create_payment_intent",
      "retry_payment_intent",
      "cancel_payment_intent",
      "timeout_payment_intent",
      "get_payment_state",
      "reconcile_payment_intent",
    ];
    if (!allowed.includes(action)) return json({ ok: false, error: "INVALID_ACTION" }, 400);

    const secretKey = (Deno.env.get("STRIPE_SECRET_KEY") ?? "").trim();
    if (!requireStripeTestKey(secretKey)) return json({ ok: false, error: "STRIPE_TEST_KEY_REQUIRED" }, 503);
    const stripe = stripeClient(secretKey);

    if (action === "connection_token") {
      const stationId = typeof body.stationId === "string" ? body.stationId.trim() : "";
      if (!stationId) return json({ ok: false, error: "MISSING_STATION" }, 400);
      const device = await kioskAuth(req, db, stationId);
      if (!device) return json({ ok: false, error: "KIOSK_AUTH_INVALID" }, 401);
      const binding = await bindingForStation(db, stationId);
      if (!terminalBindingUsable(binding)) return json({ ok: false, error: "TERMINAL_NOT_CONFIGURED" }, 409);

      const token = await stripe.terminal.connectionTokens.create({ location: String(binding.stripe_location_id) });
      await db.from("audit_logs").insert({
        action: "stripe.terminal.connection_token.created",
        target: stationId,
        data: {
          station_id: stationId,
          kiosk_device_id: device.id,
          stripe_location_id: binding.stripe_location_id,
          stripe_reader_id: binding.stripe_reader_id ?? null,
          environment: "test",
          rental_session_created: false,
          correlation_id: correlationId,
        },
      }).then(() => {}, () => {});
      return json({
        ok: true,
        secret: token.secret,
        locationId: binding.stripe_location_id,
        expectedReaderId: binding.stripe_reader_id ?? null,
        environment: "test",
      });
    }

    rentalSessionId = typeof body.rentalSessionId === "string" ? body.rentalSessionId : "";
    const ctx = await loadRentalContext(req, db, rentalSessionId);
    if ("error" in ctx) return json({ ok: false, error: ctx.error }, ctx.status);
    const { session, stationId, device } = ctx;

    if (action === "get_payment_state" || action === "reconcile_payment_intent") {
      const state = await projectState(db, stripe, session, action === "reconcile_payment_intent");
      await db.from("audit_logs").insert({
        action: action === "reconcile_payment_intent" ? "stripe.terminal.reconciled" : "stripe.terminal.state.read",
        target: rentalSessionId,
        data: { ...state, correlation_id: correlationId },
      }).then(() => {}, () => {});
      return json({ ok: true, ...state, environment: "test" });
    }

    if (session.paid_at) return json({ ok: false, error: "SESSION_ALREADY_PAID" }, 409);
    if (session.expires_at && Date.parse(session.expires_at) < Date.now() && !["cancel_payment_intent","timeout_payment_intent"].includes(action)) {
      return json({ ok: false, error: "SESSION_EXPIRED" }, 410);
    }

    const binding = await bindingForStation(db, stationId);
    if (!terminalBindingUsable(binding)) return json({ ok: false, error: "TERMINAL_NOT_CONFIGURED" }, 409);

    const current = await loadClaimAndAttempt(db, rentalSessionId);

    if (action === "cancel_payment_intent" || action === "timeout_payment_intent") {
      if (canonicalRail(current.claim?.rail, current.claim?.claim_state) !== "TERMINAL") {
        return json({ ok: false, error: "TERMINAL_RAIL_NOT_ENGAGED" }, 409);
      }
      const intentId = current.attempt?.stripe_payment_intent_id;
      if (!intentId) {
        if (current.attempt?.reconciliation_required || current.claim?.claim_state === "reconciliation_required") {
          return json({ ok: false, error: "PAYMENT_RECONCILIATION_REQUIRED" }, 409);
        }
        await db.rpc("release_rental_payment_rail_claim", {
          p_rental_id: rentalSessionId,
          p_expected_rail: "stripe_terminal",
          p_reason: action === "timeout_payment_intent" ? "timeout_before_stripe_side_effect" : "cancel_before_stripe_side_effect",
        });
        return json({ ok: true, rail: "NONE", railState: action === "timeout_payment_intent" ? "EXPIRED" : "CANCELLED", serverConfirmed: false });
      }

      const intent = await stripe.paymentIntents.retrieve(String(intentId));
      if (intent.status === "canceled") {
        await db.from("stripe_terminal_payment_attempts").update({ status: "canceled", canceled_at: new Date().toISOString(), reconciliation_required: false, last_reconciled_at: new Date().toISOString() }).eq("rental_session_id", rentalSessionId);
        await db.rpc("release_rental_payment_rail_claim", { p_rental_id: rentalSessionId, p_expected_rail: "stripe_terminal", p_reason: "stripe_already_canceled" });
        return json({ ok: true, rail: "NONE", railState: "CANCELLED", serverConfirmed: false });
      }
      if (intent.status === "requires_capture" || intent.status === "succeeded") {
        return json({ ok: false, error: "PAYMENT_SIDE_EFFECT_ALREADY_CONFIRMED", rail: "TERMINAL", railState: "SUCCEEDED" }, 409);
      }
      if (!stripeIntentSafelyCancelable(intent.status)) {
        await db.rpc("mark_rental_payment_rail_reconciliation_required", {
          p_rental_id: rentalSessionId, p_rail: "stripe_terminal", p_reason: `cancel_status_${intent.status}`,
        });
        await db.from("stripe_terminal_payment_attempts").update({ reconciliation_required: true, status: "reconciliation_required", last_error: `cancel_status_${intent.status}` }).eq("rental_session_id", rentalSessionId);
        return json({ ok: false, error: "PAYMENT_RECONCILIATION_REQUIRED", rail: "TERMINAL", railState: "RECOVERY_REQUIRED" }, 409);
      }

      stripeCallStarted = true;
      const canceled = await stripe.paymentIntents.cancel(String(intentId), {
        cancellation_reason: action === "timeout_payment_intent" ? "abandoned" : "requested_by_customer",
      });
      await db.from("stripe_terminal_payment_attempts").update({
        status: "canceled",
        canceled_at: new Date().toISOString(),
        timed_out_at: action === "timeout_payment_intent" ? new Date().toISOString() : null,
        reconciliation_required: false,
        last_reconciled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("rental_session_id", rentalSessionId);
      await db.rpc("release_rental_payment_rail_claim", {
        p_rental_id: rentalSessionId,
        p_expected_rail: "stripe_terminal",
        p_reason: action === "timeout_payment_intent" ? "stripe_confirmed_timeout_cancel" : "stripe_confirmed_cancel",
      });
      return json({ ok: true, paymentIntentId: canceled.id, stripeStatus: canceled.status, rail: "NONE", railState: action === "timeout_payment_intent" ? "EXPIRED" : "CANCELLED", serverConfirmed: false });
    }

    const amountCents = canonicalTerminalAmountCents(session);
    const currency = canonicalTerminalCurrency(session);
    if (!amountCents || !currency) return json({ ok: false, error: "PRICING_NOT_CONFIGURED" }, 409);
    const pricingHash = typeof session.pricing_snapshot_hash === "string" ? session.pricing_snapshot_hash : "";

    if (current.attempt?.stripe_payment_intent_id && !["canceled","failed","timed_out"].includes(String(current.attempt.status))) {
      const state = await projectState(db, stripe, session, true);
      if (state.rail !== "TERMINAL") return json({ ok: false, error: "PAYMENT_RAIL_ALREADY_CLAIMED" }, 409);
      return json({ ok: true, reused: true, ...state, clientSecret: (await stripe.paymentIntents.retrieve(String(state.paymentIntentId))).client_secret, amountCents, currency, environment: "test" });
    }

    const { error: railError } = await db.rpc("claim_rental_payment_rail", {
      p_rental_id: rentalSessionId,
      p_rail: "stripe_terminal",
      p_correlation_id: correlationId,
      p_metadata: { source: "stripe_terminal_backend", station_id: stationId, action },
    });
    if (railError) {
      const message = String(railError.message ?? "");
      if (message.includes("PAYMENT_RAIL_ALREADY_CLAIMED")) return json({ ok: false, error: "PAYMENT_RAIL_ALREADY_CLAIMED" }, 409);
      throw railError;
    }
    terminalClaimed = true;

    const previousGeneration = Number(current.attempt?.attempt_generation ?? 0);
    const generation = action === "retry_payment_intent" || ["canceled","failed","timed_out"].includes(String(current.attempt?.status))
      ? Math.max(1, previousGeneration + 1)
      : Math.max(1, previousGeneration || 1);
    const idempotencyKey = terminalIntentIdempotencyKey(rentalSessionId, amountCents, pricingHash, generation);

    const previousIds = Array.isArray(current.attempt?.previous_payment_intent_ids) ? current.attempt.previous_payment_intent_ids : [];
    const priorId = current.attempt?.stripe_payment_intent_id ? String(current.attempt.stripe_payment_intent_id) : null;
    const allPrevious = priorId && !previousIds.includes(priorId) ? [...previousIds, priorId] : previousIds;

    const attemptPayload = {
      rental_session_id: rentalSessionId,
      station_id: stationId,
      kiosk_device_id: device.id,
      stripe_location_id: binding.stripe_location_id,
      stripe_reader_id: binding.stripe_reader_id ?? null,
      stripe_payment_intent_id: null,
      previous_payment_intent_ids: allPrevious,
      amount_cents: amountCents,
      currency,
      status: "creating",
      attempt_generation: generation,
      idempotency_key: idempotencyKey,
      correlation_id: correlationId,
      reconciliation_required: false,
      last_error: null,
      updated_at: new Date().toISOString(),
    };
    const { error: attemptError } = await db.from("stripe_terminal_payment_attempts").upsert(attemptPayload, { onConflict: "rental_session_id" });
    if (attemptError) {
      await db.rpc("release_rental_payment_rail_claim", { p_rental_id: rentalSessionId, p_expected_rail: "stripe_terminal", p_reason: "attempt_persistence_failed_before_stripe" });
      terminalClaimed = false;
      throw attemptError;
    }

    const metadata: Record<string, string> = {
      rental_session_id: rentalSessionId,
      station_id: stationId,
      kiosk_device_id: String(device.id),
      stripe_terminal_location_id: String(binding.stripe_location_id),
      stripe_terminal_reader_id: String(binding.stripe_reader_id ?? ""),
      pricing_snapshot_hash: pricingHash,
      deposit_amount_cents: String(amountCents),
      payment_purpose: "rental_guarantee",
      payment_rail: "stripe_terminal",
      environment: "test",
      attempt_generation: String(generation),
    };

    stripeCallStarted = true;
    const intent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency,
      payment_method_types: ["card_present"],
      capture_method: "manual",
      description: "Chargeurs.ch — garantie de location — Terminal TEST",
      metadata,
    }, { idempotencyKey });
    createdIntentId = intent.id;

    const { error: attemptUpdateError } = await db.from("stripe_terminal_payment_attempts").update({
      stripe_payment_intent_id: intent.id,
      status: intent.status,
      reconciliation_required: false,
      last_reconciled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("rental_session_id", rentalSessionId);
    if (attemptUpdateError) throw attemptUpdateError;

    const { error: sessionUpdateError } = await db.from("rental_sessions").update({
      stripe_payment_intent_id: intent.id,
      settlement_status: "pending",
      settlement_error: null,
      updated_at: new Date().toISOString(),
    }).eq("id", rentalSessionId).is("paid_at", null);
    if (sessionUpdateError) throw sessionUpdateError;

    await db.from("audit_logs").insert({
      action: generation > 1 ? "stripe.terminal.payment_intent.retried" : "stripe.terminal.payment_intent.created",
      target: rentalSessionId,
      data: {
        stripe_payment_intent_id: intent.id,
        station_id: stationId,
        kiosk_device_id: device.id,
        stripe_location_id: binding.stripe_location_id,
        stripe_reader_id: binding.stripe_reader_id ?? null,
        amount_cents: amountCents,
        currency,
        pricing_snapshot_hash: pricingHash,
        capture_method: "manual",
        payment_method_types: ["card_present"],
        attempt_generation: generation,
        environment: "test",
        correlation_id: correlationId,
      },
    }).then(() => {}, () => {});

    return json({
      ok: true,
      reused: false,
      rail: "TERMINAL",
      railState: terminalRailState(intent.status, "engaged"),
      serverConfirmed: false,
      paymentIntentId: intent.id,
      clientSecret: intent.client_secret,
      stripeStatus: intent.status,
      amountCents,
      currency,
      locationId: binding.stripe_location_id,
      expectedReaderId: binding.stripe_reader_id ?? null,
      attemptGeneration: generation,
      environment: "test",
    });
  } catch (error) {
    const raw = error as any;
    if (rentalSessionId && terminalClaimed && stripeCallStarted) {
      if (createdIntentId) {
        await db.from("stripe_terminal_payment_attempts").update({
          stripe_payment_intent_id: createdIntentId,
          reconciliation_required: true,
          status: "reconciliation_required",
          last_error: "POST_STRIPE_PERSISTENCE_FAILURE",
          updated_at: new Date().toISOString(),
        }).eq("rental_session_id", rentalSessionId).then(() => {}, () => {});
      } else {
        await db.from("stripe_terminal_payment_attempts").update({
          reconciliation_required: true,
          status: "reconciliation_required",
          last_error: "UNCERTAIN_STRIPE_SIDE_EFFECT",
          updated_at: new Date().toISOString(),
        }).eq("rental_session_id", rentalSessionId).then(() => {}, () => {});
      }
      await db.rpc("mark_rental_payment_rail_reconciliation_required", {
        p_rental_id: rentalSessionId,
        p_rail: "stripe_terminal",
        p_reason: createdIntentId ? "post_stripe_persistence_failure" : "uncertain_stripe_side_effect",
      }).then(() => {}, () => {});
    }
    console.error("stripe-terminal-backend", {
      code: raw?.code ?? null,
      message: String(raw?.message ?? "TERMINAL_BACKEND_FAILED").slice(0, 500),
      correlationId,
    });
    return json({ ok: false, error: stripeCallStarted ? "PAYMENT_RECONCILIATION_REQUIRED" : "STRIPE_TERMINAL_BACKEND_FAILED" }, stripeCallStarted ? 409 : 500);
  }
});
