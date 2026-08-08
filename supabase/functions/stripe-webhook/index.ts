// stripe-webhook — signature verification, retryable event inbox and trusted
// initial deposit processing.
//
// Battery ejection happens only after:
//  - card: PaymentIntent authorized and requires_capture;
//  - automatically captured method: PaymentIntent captured successfully.
//
// Webhook claim semantics are implemented by claim_stripe_webhook_event():
// processed events are idempotent, concurrent handlers are rejected, and a
// failed/stale handler can be retried by Stripe.
import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import { adminClient, logApi, auditLog, snapshotHash } from "../_shared/db.ts";
import { evaluatePaymentMatch } from "../_shared/payments.ts";
import { resolveSettlementStrategy } from "../_shared/settlement.ts";
import { appendRentalEvent, OrchestratorError } from "../_shared/rentalOrchestratorRuntime.ts";
import { validateStripeTestRuntime } from "../_shared/stripeRuntimeConfig.ts";


type DB = ReturnType<typeof adminClient>;
type RentalSession = Record<string, any>;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

function safeErrorCode(error: unknown): string {
  if (error instanceof OrchestratorError) return error.code;
  if (error instanceof Error && /^[A-Z0-9_:-]+$/.test(error.message)) return error.message.slice(0, 120);
  return error instanceof Error ? error.name : "UNKNOWN_ERROR";
}

function webhookProjection(event: Stripe.Event): Record<string, unknown> {
  // Preserve only identifiers needed to trace a signed webhook to its local
  // rental. The raw Stripe event can contain customer data and is not needed
  // for retry/idempotency semantics.
  const object = event.data.object as {
    id?: unknown;
    metadata?: Record<string, unknown> | null;
    payment_intent?: unknown;
  };
  const metadata = object.metadata ?? {};
  const rentalSessionId = typeof metadata.rental_session_id === "string"
    ? metadata.rental_session_id
    : null;
  const paymentIntentId = typeof object.payment_intent === "string"
    ? object.payment_intent
    : null;
  return {
    type: event.type,
    object_id: typeof object.id === "string" ? object.id : null,
    rental_session_id: rentalSessionId,
    payment_intent_id: paymentIntentId,
  };
}

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

async function loadRental(db: DB, rentalSessionId: string): Promise<RentalSession | null> {
  const { data, error } = await db.from("rental_sessions")
    .select("*")
    .eq("id", rentalSessionId)
    .maybeSingle();
  if (error) throw error;
  return data as RentalSession | null;
}

async function failPaymentRental(
  db: DB,
  session: RentalSession,
  input: { code: string; message: string; idempotencyKey: string; metadata?: Record<string, unknown> },
) {
  await appendRentalEvent(db, {
    rentalId: String(session.id),
    eventType: "rental_failed",
    idempotencyKey: input.idempotencyKey,
    stationId: String(session.station_id ?? "") || null,
    paymentIntentId: String(session.stripe_payment_intent_id ?? "") || null,
    failureReason: input.code,
    metadata: { code: input.code, ...(input.metadata ?? {}) },
  });

  const terminalState = input.code === "CHECKOUT_EXPIRED"
    ? "payment_expired"
    : ["ASYNC_PAYMENT_FAILED", "PAYMENT_INTENT_FAILED"].includes(input.code)
      ? "payment_failed"
      : "needs_support";
  const { error } = await db.from("rental_sessions").update({
    state: terminalState,
    settlement_status: "failed",
    settlement_error: input.code,
    failure_code: input.code,
    failure_message: input.message,
  }).eq("id", session.id);
  if (error) throw error;
}

async function triggerEjection(rentalSessionId: string): Promise<void> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRole) throw new Error("SUPABASE_INTERNAL_CONFIG_MISSING");

  const response = await fetch(`${supabaseUrl}/functions/v1/eject-after-payment`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceRole}`,
    },
    body: JSON.stringify({ rentalSessionId }),
  });
  if (!response.ok) throw new Error(`EJECT_TRIGGER_HTTP_${response.status}`);
}

async function processPaymentIntent(
  db: DB,
  stripe: Stripe,
  session: RentalSession,
  intent: Stripe.PaymentIntent,
  event: Stripe.Event,
  checkout?: Stripe.Checkout.Session,
): Promise<boolean> {
  const methodType = await paymentMethodType(stripe, intent, checkout);
  const strategy = resolveSettlementStrategy({
    paymentMethodType: methodType,
    captureMethod: intent.capture_method,
  });

  const authorized = strategy === "manual_capture" && intent.status === "requires_capture";
  const prepaid = strategy === "prepaid_refund" && intent.status === "succeeded";

  const expectedCents = Number(
    session.deposit_amount_cents ?? checkout?.metadata?.deposit_amount_cents ?? intent.metadata?.deposit_amount_cents ?? 0,
  );
  const observedCents = strategy === "manual_capture"
    ? Number(intent.amount ?? 0)
    : Number(intent.amount_received ?? checkout?.amount_total ?? 0);
  const expectedCurrency = String(session.currency ?? "CHF").toLowerCase();
  const observedCurrency = String(intent.currency ?? checkout?.currency ?? "").toLowerCase();

  const paymentMethodId = typeof intent.payment_method === "string"
    ? intent.payment_method
    : intent.payment_method?.id ?? null;
  const customerId = typeof intent.customer === "string"
    ? intent.customer
    : intent.customer?.id ?? (
      typeof checkout?.customer === "string" ? checkout.customer : checkout?.customer?.id ?? null
    );

  const { error: paymentUpdateError } = await db.from("payments").update({
    status: authorized ? "authorized" : prepaid ? "succeeded" : "pending",
    stripe_payment_intent_id: intent.id,
    payment_method: methodType,
    raw_webhook: { id: event.id, type: event.type, intent_status: intent.status },
    capture_method: intent.capture_method,
    settlement_strategy: strategy,
    amount_authorized_cents: authorized ? Number(intent.amount_capturable ?? intent.amount ?? 0) : 0,
    amount_captured_cents: prepaid ? Number(intent.amount_received ?? observedCents) : 0,
    stripe_payment_method_id: paymentMethodId,
    stripe_customer_id: customerId,
  }).eq("rental_session_id", session.id);
  if (paymentUpdateError) throw paymentUpdateError;

  // Async methods can complete Checkout before funds are captured. The later
  // async_payment_succeeded event re-enters with prepaid=true.
  if (!authorized && !prepaid) return true;

  let recomputedHash: string | null = null;
  const storedHash = session.pricing_snapshot_hash ?? null;
  const metadataHash = checkout?.metadata?.pricing_snapshot_hash ?? intent.metadata?.pricing_snapshot_hash ?? null;
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
    const failureCode = match.failureCode ?? "DEPOSIT_PAYMENT_MISMATCH";
    await failPaymentRental(db, session, {
      code: failureCode,
      message: !match.snapshotOk
        ? "Incohérence du snapshot tarifaire — vérification manuelle requise."
        : `Montant initial ou devise incompatible avec la caution attendue.`,
      idempotencyKey: `payment_mismatch:${intent.id}`,
      metadata: {
        observedCents,
        expectedCents,
        observedCurrency,
        expectedCurrency,
      },
    });

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

  const amountCapturedCents = prepaid ? Number(intent.amount_received ?? observedCents) : 0;
  const amountAuthorizedCents = authorized
    ? Number(intent.amount_capturable ?? intent.amount ?? expectedCents)
    : 0;

  await appendRentalEvent(db, {
    rentalId: String(session.id),
    eventType: "payment_authorized",
    idempotencyKey: `payment_authorized:${intent.id}`,
    paymentIntentId: intent.id,
    stationId: String(session.station_id ?? "") || null,
    metadata: {
      stripeEventId: event.id,
      methodType,
      settlementStrategy: strategy,
      authorizedCents: amountAuthorizedCents,
      capturedCents: amountCapturedCents,
      currency: observedCurrency,
    },
  });

  const customerEmail = checkout?.customer_details?.email ?? checkout?.customer_email ?? null;
  const { data: updated, error: updateError } = await db.from("rental_sessions").update({
    // Compatibility projection for existing UI and functions.
    state: "payment_succeeded",
    stripe_payment_intent_id: intent.id,
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
    .in("state", ["checkout_created", "created", "payment_processing", "payment_pending"])
    .select("id");
  if (updateError) throw updateError;

  await auditLog(db, {
    action: authorized ? "stripe.payment.authorized" : "stripe.payment.prepaid",
    target: session.id,
    data: {
      payment_intent: intent.id,
      method_type: methodType,
      capture_method: intent.capture_method,
      settlement_strategy: strategy,
      authorized_cents: amountAuthorizedCents,
      captured_cents: amountCapturedCents,
      currency: observedCurrency,
      pricing_snapshot_hash: storedHash ?? metadataHash,
    },
  });

  if (updated && updated.length > 0) await triggerEjection(String(session.id));
  return true;
}

async function fulfil(
  db: DB,
  stripe: Stripe,
  checkout: Stripe.Checkout.Session,
  event: Stripe.Event,
): Promise<boolean> {
  const rentalSessionId = checkout.metadata?.rental_session_id;
  if (!rentalSessionId) return false;

  const session = await loadRental(db, rentalSessionId);
  if (!session) return false;

  const paymentIntentId = typeof checkout.payment_intent === "string"
    ? checkout.payment_intent
    : checkout.payment_intent?.id;
  if (!paymentIntentId) throw new Error("PAYMENT_INTENT_MISSING");

  const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
  return processPaymentIntent(db, stripe, session, intent, event, checkout);
}

async function markWebhook(
  db: DB,
  eventId: string,
  status: "processed" | "ignored" | "failed",
  errorCode?: string,
) {
  await db.from("webhook_events").update({
    processing_status: status,
    processed: status === "processed",
    processed_at: status === "failed" ? null : new Date().toISOString(),
    processing_error: errorCode ? errorCode.slice(0, 200) : null,
  }).eq("external_id", eventId);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const db = adminClient();
  const signature = req.headers.get("stripe-signature");
  const raw = await req.text();

  const stripeRuntime = validateStripeTestRuntime({ requireWebhookSecret: true });
  if (!stripeRuntime.ok) return json({ error: stripeRuntime.error }, 503);
  if (!signature) return json({ error: "MISSING_SIGNATURE" }, 400);

  const stripe = new Stripe(stripeRuntime.secretKey, {
    apiVersion: "2024-12-18.acacia",
    httpClient: Stripe.createFetchHttpClient(),
  });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, signature, stripeRuntime.webhookSecret);
  } catch {
    return json({ error: "INVALID_SIGNATURE" }, 400);
  }

  const { data: claim, error: claimError } = await db.rpc("claim_stripe_webhook_event", {
    p_external_id: event.id,
    p_event_type: event.type,
    p_payload: webhookProjection(event),
    p_lock_ttl_minutes: 10,
  });

  if (claimError) {
    await logApi(db, {
      service: "stripe",
      endpoint: "webhook:claim",
      method: "POST",
      status_code: 500,
      error: claimError.code ?? "WEBHOOK_CLAIM_FAILED",
      response: { event_id: event.id, type: event.type },
    });
    return json({ error: "WEBHOOK_CLAIM_FAILED" }, 500);
  }

  if (claim === "duplicate") return json({ received: true, duplicate: true });
  if (claim === "in_progress") return json({ received: true, in_progress: true }, 202);
  if (claim !== "claimed") return json({ error: "WEBHOOK_NOT_CLAIMED" }, 500);

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
        const session = await loadRental(db, rentalSessionId);
        if (!session) {
          handled = false;
          break;
        }
        handled = await processPaymentIntent(db, stripe, session, intent, event);
        break;
      }

      case "checkout.session.async_payment_failed": {
        const checkout = event.data.object as Stripe.Checkout.Session;
        const rentalSessionId = checkout.metadata?.rental_session_id;
        if (!rentalSessionId) {
          handled = false;
          break;
        }
        const session = await loadRental(db, rentalSessionId);
        if (!session) {
          handled = false;
          break;
        }
        if (!["authorized", "prepaid", "settled"].includes(String(session.settlement_status))) {
          await failPaymentRental(db, session, {
            code: "ASYNC_PAYMENT_FAILED",
            message: "Le paiement asynchrone a échoué.",
            idempotencyKey: `payment_failed:${checkout.id}`,
          });
        }
        break;
      }

      case "checkout.session.expired": {
        const checkout = event.data.object as Stripe.Checkout.Session;
        const rentalSessionId = checkout.metadata?.rental_session_id;
        if (!rentalSessionId) {
          handled = false;
          break;
        }
        const session = await loadRental(db, rentalSessionId);
        if (!session) {
          handled = false;
          break;
        }
        if (!["authorized", "prepaid", "settled"].includes(String(session.settlement_status))) {
          await failPaymentRental(db, session, {
            code: "CHECKOUT_EXPIRED",
            message: "La session de paiement a expiré.",
            idempotencyKey: `checkout_expired:${checkout.id}`,
          });
        }
        break;
      }

      case "payment_intent.payment_failed": {
        const intent = event.data.object as Stripe.PaymentIntent;
        const rentalSessionId = intent.metadata?.rental_session_id;
        const session = rentalSessionId
          ? await loadRental(db, rentalSessionId)
          : (await db.from("rental_sessions").select("*").eq("stripe_payment_intent_id", intent.id).maybeSingle()).data;
        if (!session) {
          handled = false;
          break;
        }
        if (!["authorized", "prepaid", "settled"].includes(String(session.settlement_status))) {
          await failPaymentRental(db, session, {
            code: "PAYMENT_INTENT_FAILED",
            message: "Le paiement a été refusé.",
            idempotencyKey: `payment_failed:${intent.id}`,
            metadata: { declineCode: intent.last_payment_error?.decline_code ?? null },
          });
        }
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
        const { data: session, error: sessionReadError } = await db.from("rental_sessions")
          .select("*")
          .eq("stripe_payment_intent_id", paymentIntentId)
          .maybeSingle();
        if (sessionReadError) throw sessionReadError;

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

        if (session) {
          try {
            await appendRentalEvent(db, {
              rentalId: String(session.id),
              eventType: "payment_refunded",
              idempotencyKey: `payment_refunded:${charge.id}:${charge.amount_refunded}`,
              paymentIntentId,
              finalAmountChf: Number(session.final_amount_cents ?? 0) / 100,
              metadata: { chargeId: charge.id, amountRefundedCents: charge.amount_refunded },
            });
          } catch (error) {
            // A refund after a completed lifecycle is an accounting adjustment,
            // not a reason to reject Stripe's webhook. Preserve the financial
            // record and surface the transition mismatch through audit.
            if (!(error instanceof OrchestratorError) || error.code !== "INVALID_TRANSITION") throw error;
            await auditLog(db, {
              action: "orchestrator.refund_transition_skipped",
              target: String(session.id),
              data: { payment_intent: paymentIntentId, charge_id: charge.id },
            });
          }
        }
        break;
      }

      default:
        handled = false;
        break;
    }

    await markWebhook(db, event.id, handled ? "processed" : "ignored");
    return json({ received: true, handled });
  } catch (error) {
    const code = safeErrorCode(error);
    await markWebhook(db, event.id, "failed", code);
    await logApi(db, {
      service: "stripe",
      endpoint: "webhook:handle",
      method: "POST",
      status_code: 500,
      error: code,
      response: { event_id: event.id, type: event.type },
    });
    // A non-2xx response is intentional: Stripe will retry, and the database
    // inbox will allow the failed event to be claimed again.
    return json({ error: "WEBHOOK_PROCESSING_FAILED" }, 500);
  }
});
