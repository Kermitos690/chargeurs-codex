// stripe-webhook — signature verification, retryable event inbox and trusted
// initial deposit processing.
//
// Battery ejection happens only after:
//  - card: PaymentIntent authorized and requires_capture;
//  - TWINT/automatic method: PaymentIntent captured successfully.
//
// Webhook claim semantics are implemented by claim_stripe_webhook_event():
// processed events are idempotent, concurrent handlers are rejected, and a
// failed/stale handler can be retried by Stripe.
import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import { adminClient, logApi, auditLog, snapshotHash } from "../_shared/db.ts";
import { evaluatePaymentMatch } from "../_shared/payments.ts";
import { resolveSettlementStrategy } from "../_shared/settlement.ts";

const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";

type DB = ReturnType<typeof adminClient>;

async function paymentMethodType(
  stripe: Stripe,
  intent: Stripe.PaymentIntent,
  session?: Stripe.Checkout.Session,
): Promise<string> {
  const id = typeof intent.payment_method === "string" ? intent.payment_method : intent.payment_method?.id;
  if (id) {
    try {
      const method = await stripe.paymentMethods.retrieve(id);
      if (method.type) return method.type;
    } catch (_) { /* fall back to intent/session types */ }
  }
  return intent.payment_method_types?.[0] ?? session?.payment_method_types?.[0] ?? "unknown";
}

async function fulfil(
  db: DB,
  stripe: Stripe,
  checkout: Stripe.Checkout.Session,
  event: Stripe.Event,
): Promise<boolean> {
  const rentalSessionId = checkout.metadata?.rental_session_id;
  if (!rentalSessionId) return false;

  const { data: session, error: sessionError } = await db.from("rental_sessions")
    .select("*").eq("id", rentalSessionId).maybeSingle();
  if (sessionError) throw sessionError;
  if (!session) return false;

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

  const expectedCents = Number(
    session.deposit_amount_cents ?? checkout.metadata?.deposit_amount_cents ?? 0,
  );
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

  // Async methods can complete Checkout before funds are captured. The later
  // async_payment_succeeded event will re-enter this function with prepaid=true.
  if (!authorized && !prepaid) return true;

  let recomputedHash: string | null = null;
  const storedHash = session.pricing_snapshot_hash ?? null;
  const metadataHash = checkout.metadata?.pricing_snapshot_hash ?? null;
  if (session.pricing_snapshot) recomputedHash = await snapshotHash(session.pricing_snapshot);

  const match = evaluatePaymentMatch({
    expectedCents,
    paidCents: observedCents,
    expectedCurrency,
    paidCurrency: observedCurrency,
    hasSnapshot: Boolean(session.pricing_snapshot),
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
        : `Montant initial ${observedCents} ${observedCurrency} ≠ caution attendue ${expectedCents} ${expectedCurrency}.`,
    }).eq("id", session.id);
    if (error) throw error;

    await auditLog(db, {
      action: "pricing.error",
      target: session.id,
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

  const customerEmail = checkout.customer_details?.email ?? checkout.customer_email ?? null;
  const amountCapturedCents = prepaid ? Number(intent.amount_received ?? observedCents) : 0;
  const amountAuthorizedCents = authorized
    ? Number(intent.amount_capturable ?? intent.amount ?? expectedCents)
    : 0;

  const { data: updated, error: updateError } = await db.from("rental_sessions").update({
    // Legacy state retained until the new Rental Orchestrator is authoritative.
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
  }).eq("id", session.id)
    .in("state", ["checkout_created", "created", "payment_processing"])
    .select();
  if (updateError) throw updateError;

  if (updated && updated.length > 0) {
    await auditLog(db, {
      action: authorized ? "stripe.payment.authorized" : "stripe.payment.prepaid",
      target: session.id,
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

    const ejectResponse = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/eject-after-payment`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({ rentalSessionId }),
    });
    if (!ejectResponse.ok) {
      throw new Error(`EJECT_TRIGGER_HTTP_${ejectResponse.status}`);
    }
  }

  return true;
}

async function markWebhook(
  db: DB,
  eventId: string,
  status: "processed" | "ignored" | "failed",
  error?: string,
) {
  await db.from("webhook_events").update({
    processing_status: status,
    processed_at: status === "failed" ? null : new Date().toISOString(),
    processing_error: error ? error.slice(0, 1000) : null,
  }).eq("external_id", eventId);
}

Deno.serve(async (req) => {
  const db = adminClient();
  const signature = req.headers.get("stripe-signature");
  const raw = await req.text();

  if (!STRIPE_KEY || !WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: "STRIPE_NOT_CONFIGURED" }), { status: 503 });
  }

  const stripe = new Stripe(STRIPE_KEY, {
    apiVersion: "2024-12-18.acacia",
    httpClient: Stripe.createFetchHttpClient(),
  });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, signature!, WEBHOOK_SECRET);
  } catch (error) {
    return new Response(JSON.stringify({ error: "INVALID_SIGNATURE", detail: String(error) }), { status: 400 });
  }

  const { data: claim, error: claimError } = await db.rpc("claim_stripe_webhook_event", {
    p_external_id: event.id,
    p_event_type: event.type,
    p_payload: { type: event.type },
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
    return new Response(JSON.stringify({ error: "WEBHOOK_CLAIM_FAILED" }), { status: 500 });
  }

  if (claim === "duplicate") {
    return new Response(JSON.stringify({ received: true, duplicate: true }), { status: 200 });
  }
  if (claim === "in_progress") {
    return new Response(JSON.stringify({ received: true, in_progress: true }), { status: 202 });
  }
  if (claim !== "claimed") {
    return new Response(JSON.stringify({ error: "WEBHOOK_NOT_CLAIMED" }), { status: 500 });
  }

  await logApi(db, {
    service: "stripe",
    endpoint: "webhook",
    method: "POST",
    status_code: 200,
    response: { type: event.type, event_id: event.id },
  });

  let handled = true;
  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        handled = await fulfil(db, stripe, event.data.object as Stripe.Checkout.Session, event);
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
        }).eq("id", rentalSessionId);
        if (error) throw error;
        break;
      }

      case "checkout.session.async_payment_failed": {
        const checkout = event.data.object as Stripe.Checkout.Session;
        if (!checkout.metadata?.rental_session_id) {
          handled = false;
          break;
        }
        const { error } = await db.from("rental_sessions").update({
          state: "payment_failed",
          settlement_status: "failed",
          settlement_error: "ASYNC_PAYMENT_FAILED",
          failure_code: "ASYNC_PAYMENT_FAILED",
          failure_message: "Le paiement asynchrone a échoué.",
        }).eq("id", checkout.metadata.rental_session_id);
        if (error) throw error;
        break;
      }

      case "checkout.session.expired": {
        const checkout = event.data.object as Stripe.Checkout.Session;
        if (!checkout.metadata?.rental_session_id) {
          handled = false;
          break;
        }
        const { error } = await db.from("rental_sessions").update({
          state: "payment_expired",
          settlement_status: "failed",
          settlement_error: "CHECKOUT_EXPIRED",
        }).eq("id", checkout.metadata.rental_session_id)
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
          failure_message: intent.last_payment_error?.message ?? "Paiement refusé.",
        }).eq("stripe_payment_intent_id", intent.id)
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
        }).eq("stripe_payment_intent_id", paymentIntentId);
        if (sessionError) throw sessionError;
        break;
      }

      default:
        handled = false;
        break;
    }

    await markWebhook(db, event.id, handled ? "processed" : "ignored");
    return new Response(JSON.stringify({ received: true, handled }), { status: 200 });
  } catch (error) {
    const message = String(error);
    await markWebhook(db, event.id, "failed", message);
    await logApi(db, {
      service: "stripe",
      endpoint: "webhook:handle",
      method: "POST",
      status_code: 500,
      error: message,
      response: { event_id: event.id, type: event.type },
    });
    // A non-2xx response is intentional: Stripe will retry, and the database
    // inbox will allow the failed event to be claimed again.
    return new Response(JSON.stringify({ error: "WEBHOOK_PROCESSING_FAILED" }), { status: 500 });
  }
});
