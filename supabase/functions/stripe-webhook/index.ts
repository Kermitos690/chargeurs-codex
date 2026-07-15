// stripe-webhook — canonical Chargeurs.ch Stripe inbox and initial deposit
// processing. Signature verification happens before any database mutation.
//
// Battery ejection is allowed only after:
// - card / eligible wallet: PaymentIntent authorized (`requires_capture`);
// - TWINT / automatic method: PaymentIntent captured successfully.
//
// Failed handlers return HTTP 500 so Stripe retries. The PostgreSQL inbox
// permits failed or stale events to be reclaimed without processing one event
// concurrently twice.
import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import { adminClient, logApi, auditLog, snapshotHash } from "../_shared/db.ts";
import { evaluatePaymentMatch } from "../_shared/payments.ts";
import { resolveSettlementStrategy } from "../_shared/settlement.ts";

const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
const FLOW_ENABLED = (Deno.env.get("ENABLE_CANONICAL_SETTLEMENT_FLOW") ?? "false").toLowerCase() === "true";
const LIVE_ENABLED = (Deno.env.get("ENABLE_CANONICAL_SETTLEMENT_LIVE") ?? "false").toLowerCase() === "true";
const REQUIRED_DEPOSIT_CENTS = 3_000;
const MAX_BODY_BYTES = 1024 * 1024;

type DB = ReturnType<typeof adminClient>;
type Session = Record<string, unknown>;

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isLiveStripeKey(key: string): boolean {
  return key.startsWith("sk_live_");
}

async function paymentMethodType(
  stripe: Stripe,
  intent: Stripe.PaymentIntent,
  checkout?: Stripe.Checkout.Session,
): Promise<string> {
  const id = typeof intent.payment_method === "string" ? intent.payment_method : intent.payment_method?.id;
  if (id) {
    try {
      const method = await stripe.paymentMethods.retrieve(id);
      if (method.type) return method.type;
    } catch {
      // Fall back to the PaymentIntent / Checkout declared method types.
    }
  }
  return intent.payment_method_types?.[0] ?? checkout?.payment_method_types?.[0] ?? "unknown";
}

async function markWebhook(
  db: DB,
  eventId: string,
  status: "processed" | "ignored" | "failed",
  error?: string,
): Promise<void> {
  const { error: updateError } = await db.from("webhook_events").update({
    processing_status: status,
    processed_at: status === "failed" ? null : new Date().toISOString(),
    processing_error: error ? error.slice(0, 1000) : null,
  }).eq("provider", "stripe").eq("external_id", eventId);
  if (updateError) throw updateError;
}

async function triggerEjection(db: DB, rentalSessionId: string): Promise<void> {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/eject-after-payment`;
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!serviceRole || !Deno.env.get("SUPABASE_URL")) throw new Error("INTERNAL_EJECTION_CALL_NOT_CONFIGURED");

  const ejectResponse = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceRole}`,
    },
    body: JSON.stringify({ rentalSessionId }),
  });

  if (!ejectResponse.ok) {
    await logApi(db, {
      service: "chargenow",
      endpoint: "eject-after-payment",
      method: "POST",
      status_code: ejectResponse.status,
      request: { rentalSessionId },
      error: "EJECTION_TRIGGER_FAILED",
    });
    throw new Error(`EJECT_TRIGGER_HTTP_${ejectResponse.status}`);
  }
}

async function processCheckoutDeposit(
  db: DB,
  stripe: Stripe,
  checkout: Stripe.Checkout.Session,
  event: Stripe.Event,
): Promise<boolean> {
  const rentalSessionId = checkout.metadata?.rental_session_id;
  if (!rentalSessionId) return false;

  const { data: rawSession, error: sessionError } = await db.from("rental_sessions")
    .select("*").eq("id", rentalSessionId).maybeSingle();
  if (sessionError) throw sessionError;
  if (!rawSession) return false;
  const session = rawSession as Session;

  const paymentIntentId = typeof checkout.payment_intent === "string"
    ? checkout.payment_intent
    : checkout.payment_intent?.id;
  if (!paymentIntentId) throw new Error("PAYMENT_INTENT_MISSING");

  const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
  const methodType = await paymentMethodType(stripe, intent, checkout);
  const strategy = resolveSettlementStrategy({
    paymentMethodType: methodType,
    captureMethod: intent.capture_method,
  });

  const authorized = strategy === "manual_capture" && intent.status === "requires_capture";
  const prepaid = strategy === "prepaid_refund" &&
    (intent.status === "succeeded" || checkout.payment_status === "paid");

  const expectedCents = Number(session.deposit_amount_cents ?? 0);
  if (!Number.isInteger(expectedCents) || expectedCents !== REQUIRED_DEPOSIT_CENTS) {
    throw new Error("DEPOSIT_NOT_CONFIGURED");
  }

  const observedCents = strategy === "manual_capture"
    ? Number(intent.amount ?? 0)
    : Number(intent.amount_received ?? checkout.amount_total ?? 0);
  const expectedCurrency = String(session.currency ?? "CHF").toLowerCase();
  const observedCurrency = String(intent.currency ?? checkout.currency ?? "").toLowerCase();

  const paymentMethodId = typeof intent.payment_method === "string"
    ? intent.payment_method
    : intent.payment_method?.id ?? null;
  const customerId = typeof intent.customer === "string"
    ? intent.customer
    : intent.customer?.id ?? (
      typeof checkout.customer === "string" ? checkout.customer : checkout.customer?.id ?? null
    );

  const { error: paymentUpdateError } = await db.from("payments").update({
    status: authorized ? "authorized" : prepaid ? "succeeded" : "pending",
    stripe_payment_intent_id: paymentIntentId,
    payment_method: methodType,
    raw_webhook: { id: event.id, type: event.type, intent_status: intent.status },
    capture_method: intent.capture_method,
    settlement_strategy: strategy,
    amount_authorized_cents: authorized ? Number(intent.amount_capturable ?? intent.amount ?? 0) : 0,
    amount_captured_cents: prepaid ? Number(intent.amount_received ?? observedCents) : 0,
    stripe_payment_method_id: paymentMethodId,
    stripe_customer_id: customerId,
  }).eq("stripe_session_id", checkout.id);
  if (paymentUpdateError) throw paymentUpdateError;

  // Async methods may complete Checkout before funds are captured. Their later
  // async_payment_succeeded event will return here with prepaid=true.
  if (!authorized && !prepaid) return true;

  const storedHash = typeof session.pricing_snapshot_hash === "string" ? session.pricing_snapshot_hash : null;
  const metadataHash = checkout.metadata?.pricing_snapshot_hash ?? null;
  const pricingSnapshot = session.pricing_snapshot as Record<string, unknown> | null;
  const recomputedHash = pricingSnapshot ? await snapshotHash(pricingSnapshot) : null;

  const match = evaluatePaymentMatch({
    expectedCents,
    paidCents: observedCents,
    expectedCurrency,
    paidCurrency: observedCurrency,
    hasSnapshot: Boolean(pricingSnapshot),
    storedHash,
    recomputedHash,
    metaHash: metadataHash,
  });

  if (!match.ok) {
    const { error } = await db.from("rental_sessions").update({
      state: "needs_support",
      settlement_status: "manual_review",
      settlement_error: match.failureCode,
      failure_code: match.failureCode,
      failure_message: !match.snapshotOk
        ? "Incohérence du snapshot tarifaire — vérification manuelle requise."
        : "La caution Stripe ne correspond pas au montant ou à la devise attendus.",
    }).eq("id", rentalSessionId);
    if (error) throw error;

    await auditLog(db, {
      action: "pricing.error",
      target: rentalSessionId,
      data: {
        code: !match.snapshotOk ? "SNAPSHOT_MISMATCH" : "DEPOSIT_AMOUNT_MISMATCH",
        observed_cents: observedCents,
        expected_cents: expectedCents,
        observed_currency: observedCurrency,
        expected_currency: expectedCurrency,
        recomputed_hash: recomputedHash,
        stored_hash: storedHash,
        metadata_hash: metadataHash,
      },
    });
    return true;
  }

  const amountCapturedCents = prepaid ? Number(intent.amount_received ?? observedCents) : 0;
  const amountAuthorizedCents = authorized
    ? Number(intent.amount_capturable ?? intent.amount ?? expectedCents)
    : 0;
  const customerEmail = checkout.customer_details?.email ?? checkout.customer_email ?? null;

  const { data: transitioned, error: updateError } = await db.from("rental_sessions").update({
    state: "payment_succeeded",
    stripe_payment_intent_id: paymentIntentId,
    stripe_customer_id: customerId,
    stripe_payment_method_id: paymentMethodId,
    stripe_payment_method_type: methodType,
    customer_email: customerEmail,
    amount_paid: amountCapturedCents / 100,
    captured_amount_cents: amountCapturedCents,
    settlement_strategy: strategy,
    settlement_status: authorized ? "authorized" : "prepaid",
    settlement_error: null,
    paid_at: new Date().toISOString(),
  }).eq("id", rentalSessionId)
    .in("state", ["checkout_created", "created", "payment_processing"])
    .select("id");
  if (updateError) throw updateError;

  const transitionedNow = Boolean(transitioned?.length);
  const recoverInterruptedEjection = !transitionedNow && session.state === "payment_succeeded" &&
    (session.settlement_status === "authorized" || session.settlement_status === "prepaid");

  if (transitionedNow) {
    await auditLog(db, {
      action: authorized ? "stripe.payment.authorized" : "stripe.payment.prepaid",
      target: rentalSessionId,
      data: {
        payment_intent: paymentIntentId,
        method_type: methodType,
        capture_method: intent.capture_method,
        settlement_strategy: strategy,
        authorized_cents: amountAuthorizedCents,
        captured_cents: amountCapturedCents,
        currency: observedCurrency,
        pricing_snapshot_hash: storedHash ?? metadataHash,
      },
    });
  }

  if (transitionedNow || recoverInterruptedEjection) {
    await triggerEjection(db, rentalSessionId);
  }

  return true;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return response({ error: "METHOD_NOT_ALLOWED" }, 405);
  if (!FLOW_ENABLED) return response({ error: "CANONICAL_SETTLEMENT_FLOW_DISABLED" }, 503);
  if (!STRIPE_KEY || !WEBHOOK_SECRET) return response({ error: "STRIPE_NOT_CONFIGURED" }, 503);
  if (isLiveStripeKey(STRIPE_KEY) && !LIVE_ENABLED) return response({ error: "LIVE_SETTLEMENT_DISABLED" }, 503);

  const signature = req.headers.get("stripe-signature");
  if (!signature) return response({ error: "INVALID_SIGNATURE" }, 400);

  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return response({ error: "PAYLOAD_TOO_LARGE" }, 413);
  }

  const raw = await req.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return response({ error: "PAYLOAD_TOO_LARGE" }, 413);
  }

  const stripe = new Stripe(STRIPE_KEY, {
    apiVersion: "2024-12-18.acacia",
    httpClient: Stripe.createFetchHttpClient(),
  });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, signature, WEBHOOK_SECRET);
  } catch {
    return response({ error: "INVALID_SIGNATURE" }, 400);
  }

  const db = adminClient();
  const { data: claim, error: claimError } = await db.rpc("claim_stripe_webhook_event", {
    p_external_id: event.id,
    p_event_type: event.type,
    p_payload: { type: event.type, created: event.created },
    p_lock_ttl_minutes: 10,
  });

  if (claimError) {
    await logApi(db, {
      service: "stripe",
      endpoint: "webhook:claim",
      method: "POST",
      status_code: 500,
      error: claimError.message,
      response: { event_id: event.id, type: event.type },
    });
    return response({ error: "WEBHOOK_CLAIM_FAILED" }, 500);
  }

  if (claim === "duplicate") return response({ received: true, duplicate: true });
  if (claim === "in_progress") return response({ received: true, in_progress: true }, 202);
  if (claim !== "claimed") return response({ error: "WEBHOOK_NOT_CLAIMED" }, 500);

  let handled = true;
  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        handled = await processCheckoutDeposit(db, stripe, event.data.object as Stripe.Checkout.Session, event);
        break;

      case "payment_intent.amount_capturable_updated": {
        const intent = event.data.object as Stripe.PaymentIntent;
        const rentalSessionId = intent.metadata?.rental_session_id;
        if (!rentalSessionId) {
          handled = false;
          break;
        }
        const methodType = await paymentMethodType(stripe, intent);
        const { error } = await db.from("rental_sessions").update({
          settlement_strategy: resolveSettlementStrategy({
            paymentMethodType: methodType,
            captureMethod: intent.capture_method,
          }),
          settlement_status: "authorized",
          stripe_payment_intent_id: intent.id,
          stripe_payment_method_id: typeof intent.payment_method === "string"
            ? intent.payment_method
            : intent.payment_method?.id ?? null,
        }).eq("id", rentalSessionId).neq("settlement_status", "legacy");
        if (error) throw error;
        break;
      }

      case "checkout.session.async_payment_failed": {
        const checkout = event.data.object as Stripe.Checkout.Session;
        const rentalSessionId = checkout.metadata?.rental_session_id;
        if (!rentalSessionId) {
          handled = false;
          break;
        }
        const { error } = await db.from("rental_sessions").update({
          state: "payment_failed",
          settlement_status: "failed",
          settlement_error: "ASYNC_PAYMENT_FAILED",
          failure_code: "ASYNC_PAYMENT_FAILED",
          failure_message: "Le paiement asynchrone a échoué.",
        }).eq("id", rentalSessionId).neq("settlement_status", "legacy");
        if (error) throw error;
        break;
      }

      case "checkout.session.expired": {
        const checkout = event.data.object as Stripe.Checkout.Session;
        const rentalSessionId = checkout.metadata?.rental_session_id;
        if (!rentalSessionId) {
          handled = false;
          break;
        }
        const { error } = await db.from("rental_sessions").update({
          state: "payment_expired",
          settlement_status: "failed",
          settlement_error: "CHECKOUT_EXPIRED",
        }).eq("id", rentalSessionId)
          .neq("settlement_status", "legacy")
          .in("state", ["checkout_created", "created"]);
        if (error) throw error;
        break;
      }

      case "payment_intent.payment_failed": {
        const intent = event.data.object as Stripe.PaymentIntent;
        const { error } = await db.from("rental_sessions").update({
          state: "payment_failed",
          settlement_status: "failed",
          settlement_error: "PAYMENT_INTENT_FAILED",
          failure_code: "PAYMENT_INTENT_FAILED",
          failure_message: "Le paiement a été refusé.",
        }).eq("stripe_payment_intent_id", intent.id)
          .neq("settlement_status", "legacy")
          .in("state", ["checkout_created", "created", "payment_processing"]);
        if (error) throw error;
        break;
      }

      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        const paymentIntentId = typeof charge.payment_intent === "string"
          ? charge.payment_intent
          : charge.payment_intent?.id;
        if (!paymentIntentId) {
          handled = false;
          break;
        }
        const { error: paymentError } = await db.from("payments").update({
          status: charge.refunded ? "refunded" : "partially_refunded",
          refund_id: charge.id,
          refunded_at: new Date().toISOString(),
          amount_refunded_cents: charge.amount_refunded,
        }).eq("stripe_payment_intent_id", paymentIntentId);
        if (paymentError) throw paymentError;
        const { error: sessionError } = await db.from("rental_sessions").update({
          refunded_amount_cents: charge.amount_refunded,
        }).eq("stripe_payment_intent_id", paymentIntentId)
          .neq("settlement_status", "legacy");
        if (sessionError) throw sessionError;
        break;
      }

      default:
        handled = false;
        break;
    }

    await markWebhook(db, event.id, handled ? "processed" : "ignored");
    await logApi(db, {
      service: "stripe",
      endpoint: "webhook",
      method: "POST",
      status_code: 200,
      response: { event_id: event.id, type: event.type, handled },
    });
    return response({ received: true, handled });
  } catch (error) {
    const code = error instanceof Error ? error.message : "WEBHOOK_PROCESSING_FAILED";
    try {
      await markWebhook(db, event.id, "failed", code);
    } catch {
      // Stripe receives 500 either way and retries the signed event.
    }
    await logApi(db, {
      service: "stripe",
      endpoint: "webhook:handle",
      method: "POST",
      status_code: 500,
      error: code,
      response: { event_id: event.id, type: event.type },
    }).catch(() => {});
    return response({ error: "WEBHOOK_PROCESSING_FAILED" }, 500);
  }
});
