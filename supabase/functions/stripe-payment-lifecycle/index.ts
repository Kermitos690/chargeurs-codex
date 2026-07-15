// Internal Stripe authorization lifecycle adapter.
// Disabled by default. Never expose directly to browsers or API clients.

import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import { adminClient, auditLog, logApi } from "../_shared/db.ts";
import {
  DEFAULT_AUTHORIZATION_CENTS,
  isAuthorizationAmountAllowed,
  planSettlement,
  type SettlementReason,
} from "../_shared/paymentLifecycle.ts";

const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const ENABLED = (Deno.env.get("ENABLE_MANUAL_AUTHORIZATION_FLOW") ?? "false").toLowerCase() === "true";
const ALLOW_LIVE = (Deno.env.get("ENABLE_MANUAL_AUTHORIZATION_LIVE") ?? "false").toLowerCase() === "true";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

function internal(req: Request): boolean {
  const expected = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const auth = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  return Boolean(expected && auth && safeEqual(auth, expected));
}

function stripeMode(key: string): "test" | "live" | "unknown" {
  if (key.startsWith("sk_test_")) return "test";
  if (key.startsWith("sk_live_")) return "live";
  return "unknown";
}

async function claimOperation(
  db: ReturnType<typeof adminClient>,
  rentalId: string,
  type: string,
  idempotencyKey: string,
  amountCents: number,
) {
  const { data: existing } = await db.from("payment_lifecycle_operations")
    .select("*")
    .eq("rental_session_id", rentalId)
    .eq("operation_type", type)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existing) return { replay: true, operation: existing };

  const { data, error } = await db.from("payment_lifecycle_operations").insert({
    rental_session_id: rentalId,
    operation_type: type,
    idempotency_key: idempotencyKey,
    requested_amount_cents: amountCents,
    status: "pending",
  }).select("*").single();
  if (error) throw error;
  return { replay: false, operation: data };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");
  if (!internal(req)) return json({ ok: false, error: "FORBIDDEN" }, 403);
  if (!ENABLED) return json({ ok: false, error: "MANUAL_AUTHORIZATION_FLOW_DISABLED" }, 503);
  if (!STRIPE_KEY) return json({ ok: false, error: "STRIPE_NOT_CONFIGURED" }, 503);

  const mode = stripeMode(STRIPE_KEY);
  if (mode === "live" && !ALLOW_LIVE) return json({ ok: false, error: "LIVE_AUTHORIZATION_FLOW_DISABLED" }, 503);
  if (mode === "unknown") return json({ ok: false, error: "UNRECOGNIZED_STRIPE_KEY_MODE" }, 503);

  const db = adminClient();
  const stripe = new Stripe(STRIPE_KEY, {
    apiVersion: "2024-12-18.acacia",
    httpClient: Stripe.createFetchHttpClient(),
  });

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");
    const rentalSessionId = String(body.rentalSessionId ?? "");
    const idempotencyKey = String(body.idempotencyKey ?? req.headers.get("x-idempotency-key") ?? "");
    if (!rentalSessionId || !/^[0-9a-f-]{36}$/i.test(rentalSessionId)) return json({ ok: false, error: "INVALID_RENTAL_ID" }, 400);
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) return json({ ok: false, error: "INVALID_IDEMPOTENCY_KEY" }, 400);

    const { data: session } = await db.from("rental_sessions").select("*").eq("id", rentalSessionId).maybeSingle();
    if (!session) return json({ ok: false, error: "RENTAL_NOT_FOUND" }, 404);

    if (action === "authorize") {
      const amountCents = Number(body.amountCents ?? DEFAULT_AUTHORIZATION_CENTS);
      if (!isAuthorizationAmountAllowed(amountCents)) return json({ ok: false, error: "INVALID_AUTHORIZATION_AMOUNT" }, 400);
      if (session.stripe_payment_intent_id) return json({ ok: true, replayed: true, paymentIntentId: session.stripe_payment_intent_id });

      const claim = await claimOperation(db, session.id, "authorize", idempotencyKey, amountCents);
      if (claim.replay && claim.operation.status === "succeeded") {
        return json({ ok: true, replayed: true, paymentIntentId: claim.operation.provider_object_id });
      }

      const intent = await stripe.paymentIntents.create({
        amount: amountCents,
        currency: String(session.currency ?? "CHF").toLowerCase(),
        capture_method: "manual",
        automatic_payment_methods: { enabled: true },
        metadata: {
          rental_session_id: session.id,
          station_id: session.station_id,
          payment_flow: "manual_authorization",
        },
      }, { idempotencyKey: `chargeurs:authorize:${session.id}:${idempotencyKey}` });

      await db.from("payment_lifecycle_operations").update({
        status: "succeeded",
        provider_object_id: intent.id,
        response_summary: { status: intent.status, amount: intent.amount, currency: intent.currency },
      }).eq("id", claim.operation.id);

      await db.from("rental_sessions").update({
        payment_flow: "manual_authorization",
        stripe_payment_intent_id: intent.id,
        authorized_amount_cents: intent.amount,
        payment_finalization_status: "not_started",
        state: "payment_processing",
      }).eq("id", session.id);

      await auditLog(db, { actor: "system", action: "stripe.authorization.created", target: session.id, data: { payment_intent: intent.id, amount_cents: amountCents, mode } });
      return json({ ok: true, paymentIntentId: intent.id, clientSecret: intent.client_secret, status: intent.status, amountCents });
    }

    if (action === "settle") {
      const reason = String(body.reason ?? "returned") as SettlementReason;
      if (!["returned", "non_return", "cancelled", "release_failed"].includes(reason)) return json({ ok: false, error: "INVALID_SETTLEMENT_REASON" }, 400);
      if (!session.stripe_payment_intent_id) return json({ ok: false, error: "PAYMENT_INTENT_MISSING" }, 409);

      const calculatedRentalCents = Number(body.calculatedRentalCents ?? session.final_amount_cents ?? 0);
      const plan = planSettlement({
        reason,
        authorizedCents: Number(session.authorized_amount_cents ?? 0),
        calculatedRentalCents,
        capturedCents: Number(session.captured_amount_cents ?? 0),
        refundedCents: Number(session.refunded_amount_cents ?? 0),
      });
      if (!plan.valid) return json({ ok: false, error: plan.error }, 409);

      await db.from("rental_sessions").update({
        final_amount_cents: plan.finalTotalCents,
        additional_amount_cents: plan.additionalChargeCents,
        payment_finalization_status: "pending",
      }).eq("id", session.id);

      if (plan.cancelAuthorization) {
        const claim = await claimOperation(db, session.id, "cancel_authorization", idempotencyKey, 0);
        if (!(claim.replay && claim.operation.status === "succeeded")) {
          const intent = await stripe.paymentIntents.cancel(session.stripe_payment_intent_id, {}, {
            idempotencyKey: `chargeurs:cancel:${session.id}:${idempotencyKey}`,
          });
          await db.from("payment_lifecycle_operations").update({ status: "succeeded", provider_object_id: intent.id, response_summary: { status: intent.status } }).eq("id", claim.operation.id);
        }
        await db.from("rental_sessions").update({ payment_finalization_status: "cancelled", payment_finalized_at: new Date().toISOString() }).eq("id", session.id);
        return json({ ok: true, plan, status: "cancelled" });
      }

      if (plan.captureFromAuthorizationCents > 0) {
        const claim = await claimOperation(db, session.id, "capture", idempotencyKey, plan.captureFromAuthorizationCents);
        if (!(claim.replay && claim.operation.status === "succeeded")) {
          const intent = await stripe.paymentIntents.capture(session.stripe_payment_intent_id, {
            amount_to_capture: plan.captureFromAuthorizationCents,
          }, { idempotencyKey: `chargeurs:capture:${session.id}:${idempotencyKey}` });
          await db.from("payment_lifecycle_operations").update({ status: "succeeded", provider_object_id: intent.id, response_summary: { status: intent.status, amount_received: intent.amount_received } }).eq("id", claim.operation.id);
        }
      }

      const finalStatus = plan.additionalChargeCents > 0 ? "additional_payment_required" : "captured";
      await db.from("rental_sessions").update({
        captured_amount_cents: Number(session.captured_amount_cents ?? 0) + plan.captureFromAuthorizationCents,
        payment_finalization_status: finalStatus,
        payment_finalized_at: plan.additionalChargeCents > 0 ? null : new Date().toISOString(),
      }).eq("id", session.id);

      await auditLog(db, { actor: "system", action: "stripe.authorization.settled", target: session.id, data: { reason, plan, mode } });
      return json({ ok: true, plan, status: finalStatus });
    }

    return json({ ok: false, error: "UNKNOWN_ACTION" }, 400);
  } catch (error) {
    await logApi(db, { service: "stripe", endpoint: "payment-lifecycle", method: "POST", status_code: 500, error: String(error) });
    return json({ ok: false, error: "PAYMENT_LIFECYCLE_ERROR", detail: String(error) }, 500);
  }
});
