// stripe-webhook — verifies Stripe signatures and records the initial deposit.
// Battery ejection happens only after one of these trusted states:
//  - eligible card: PaymentIntent is authorized and requires_capture;
//  - TWINT/automatic method: PaymentIntent is captured successfully.
//
// The final rental amount is settled later by settle-rental-payment.
import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import { adminClient, logApi, auditLog, snapshotHash } from "../_shared/db.ts";
import { evaluatePaymentMatch } from "../_shared/payments.ts";
import { resolveSettlementStrategy } from "../_shared/settlement.ts";

const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";

type DB = ReturnType<typeof adminClient>;

async function paymentMethodType(stripe: Stripe, intent: Stripe.PaymentIntent, session: Stripe.Checkout.Session): Promise<string> {
  const id = typeof intent.payment_method === "string" ? intent.payment_method : intent.payment_method?.id;
  if (id) {
    try {
      const method = await stripe.paymentMethods.retrieve(id);
      if (method.type) return method.type;
    } catch (_) { /* fall back to intent/session types */ }
  }
  return intent.payment_method_types?.[0] ?? session.payment_method_types?.[0] ?? "unknown";
}

async function fulfil(
  db: DB,
  stripe: Stripe,
  cs: Stripe.Checkout.Session,
  event: Stripe.Event,
) {
  const rentalSessionId = cs.metadata?.rental_session_id;
  if (!rentalSessionId) return;

  const { data: session } = await db.from("rental_sessions")
    .select("*").eq("id", rentalSessionId).maybeSingle();
  if (!session) return;

  const paymentIntentId = typeof cs.payment_intent === "string"
    ? cs.payment_intent
    : cs.payment_intent?.id;
  if (!paymentIntentId) throw new Error("PAYMENT_INTENT_MISSING");

  const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
  const methodType = await paymentMethodType(stripe, intent, cs);
  const strategy = resolveSettlementStrategy({
    paymentMethodType: methodType,
    captureMethod: intent.capture_method,
  });

  const authorized = strategy === "manual_capture" && intent.status === "requires_capture";
  const prepaid = strategy === "prepaid_refund" &&
    (intent.status === "succeeded" || cs.payment_status === "paid");

  const expectedCents = Number(session.deposit_amount_cents ?? cs.metadata?.deposit_amount_cents ?? 0);
  const observedCents = strategy === "manual_capture"
    ? Number(intent.amount ?? 0)
    : Number(intent.amount_received ?? cs.amount_total ?? 0);
  const expectedCur = String(session.currency ?? "CHF").toLowerCase();
  const paidCur = String(intent.currency ?? cs.currency ?? "").toLowerCase();

  const paymentMethodId = typeof intent.payment_method === "string"
    ? intent.payment_method
    : intent.payment_method?.id ?? null;
  const customerId = typeof intent.customer === "string"
    ? intent.customer
    : intent.customer?.id ?? (typeof cs.customer === "string" ? cs.customer : cs.customer?.id ?? null);

  await db.from("payments").update({
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
  }).eq("stripe_session_id", cs.id);

  if (!authorized && !prepaid) return;

  let recomputedHash: string | null = null;
  const storedHash = session.pricing_snapshot_hash ?? null;
  const metaHash = cs.metadata?.pricing_snapshot_hash ?? null;
  if (session.pricing_snapshot) recomputedHash = await snapshotHash(session.pricing_snapshot);

  const match = evaluatePaymentMatch({
    expectedCents,
    paidCents: observedCents,
    expectedCurrency: expectedCur,
    paidCurrency: paidCur,
    hasSnapshot: Boolean(session.pricing_snapshot),
    storedHash,
    recomputedHash,
    metaHash,
  });

  if (!match.ok) {
    await db.from("rental_sessions").update({
      state: "needs_support",
      settlement_status: "manual_review",
      settlement_error: match.failureCode,
      failure_code: match.failureCode,
      failure_message: !match.snapshotOk
        ? "Incohérence du snapshot tarifaire — vérification manuelle requise."
        : `Montant initial ${observedCents} ${paidCur} ≠ caution attendue ${expectedCents} ${expectedCur}.`,
    }).eq("id", session.id);
    await auditLog(db, {
      action: "pricing.error", target: session.id,
      data: {
        code: !match.snapshotOk ? "SNAPSHOT_MISMATCH" : "DEPOSIT_AMOUNT_MISMATCH",
        observedCents, expectedCents, paidCur, expectedCur,
        recomputedHash, storedHash, metaHash,
      },
    });
    return;
  }

  const customerEmail = cs.customer_details?.email ?? cs.customer_email ?? null;
  const amountCapturedCents = prepaid ? Number(intent.amount_received ?? observedCents) : 0;
  const amountAuthorizedCents = authorized ? Number(intent.amount_capturable ?? intent.amount ?? expectedCents) : 0;

  const { data: updated } = await db.from("rental_sessions").update({
    // Legacy state retained until the Rental Orchestrator becomes authoritative.
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
        currency: paidCur,
        pricing_snapshot_hash: storedHash ?? metaHash,
      },
    });

    try {
      await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/eject-after-payment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({ rentalSessionId }),
      });
    } catch (_) { /* eject function logs its own errors */ }
  }
}

Deno.serve(async (req) => {
  const db = adminClient();
  const sig = req.headers.get("stripe-signature");
  const raw = await req.text();

  if (!STRIPE_KEY || !WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: "STRIPE_NOT_CONFIGURED" }), { status: 400 });
  }

  const stripe = new Stripe(STRIPE_KEY, {
    apiVersion: "2024-12-18.acacia",
    httpClient: Stripe.createFetchHttpClient(),
  });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, sig!, WEBHOOK_SECRET);
  } catch (e) {
    return new Response(JSON.stringify({ error: "INVALID_SIGNATURE", detail: String(e) }), { status: 400 });
  }

  const { error: dupErr } = await db.from("webhook_events").insert({
    provider: "stripe", external_id: event.id, event_type: event.type, payload: { type: event.type },
  });
  if (dupErr) {
    return new Response(JSON.stringify({ received: true, duplicate: true }), { status: 200 });
  }

  await logApi(db, {
    service: "stripe", endpoint: "webhook", method: "POST",
    status_code: 200, response: { type: event.type },
  });

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        await fulfil(db, stripe, event.data.object as Stripe.Checkout.Session, event);
        break;

      case "payment_intent.amount_capturable_updated": {
        const intent = event.data.object as Stripe.PaymentIntent;
        const rentalSessionId = intent.metadata?.rental_session_id;
        if (rentalSessionId) {
          const methodType = await paymentMethodType(stripe, intent, {} as Stripe.Checkout.Session);
          await db.from("rental_sessions").update({
            settlement_strategy: resolveSettlementStrategy({ paymentMethodType: methodType, captureMethod: intent.capture_method }),
            settlement_status: "authorized",
            stripe_payment_intent_id: intent.id,
            stripe_payment_method_id: typeof intent.payment_method === "string" ? intent.payment_method : intent.payment_method?.id ?? null,
          }).eq("id", rentalSessionId);
        }
        break;
      }

      case "checkout.session.async_payment_failed": {
        const cs = event.data.object as Stripe.Checkout.Session;
        if (cs.metadata?.rental_session_id) {
          await db.from("rental_sessions").update({
            state: "payment_failed", settlement_status: "failed",
            settlement_error: "ASYNC_PAYMENT_FAILED",
            failure_code: "ASYNC_PAYMENT_FAILED",
            failure_message: "Le paiement asynchrone a échoué.",
          }).eq("id", cs.metadata.rental_session_id);
        }
        break;
      }

      case "checkout.session.expired": {
        const cs = event.data.object as Stripe.Checkout.Session;
        if (cs.metadata?.rental_session_id) {
          await db.from("rental_sessions").update({
            state: "payment_expired", settlement_status: "failed",
            settlement_error: "CHECKOUT_EXPIRED",
          }).eq("id", cs.metadata.rental_session_id)
            .in("state", ["checkout_created", "created"]);
        }
        break;
      }

      case "payment_intent.payment_failed": {
        const pi = event.data.object as Stripe.PaymentIntent;
        await db.from("rental_sessions").update({
          state: "payment_failed", settlement_status: "failed",
          settlement_error: "PAYMENT_INTENT_FAILED",
          failure_code: "PAYMENT_INTENT_FAILED",
          failure_message: pi.last_payment_error?.message ?? "Paiement refusé.",
        }).eq("stripe_payment_intent_id", pi.id)
          .in("state", ["checkout_created", "created", "payment_processing"]);
        break;
      }

      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        const piId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
        if (piId) {
          await db.from("payments").update({
            status: charge.refunded ? "refunded" : "partially_refunded",
            refund_id: charge.id,
            refunded_at: new Date().toISOString(),
            amount_refunded_cents: charge.amount_refunded,
          }).eq("stripe_payment_intent_id", piId);
          await db.from("rental_sessions").update({
            refunded_amount_cents: charge.amount_refunded,
          }).eq("stripe_payment_intent_id", piId);
        }
        break;
      }

      default:
        break;
    }
  } catch (e) {
    await logApi(db, {
      service: "stripe", endpoint: "webhook:handle", method: "POST",
      status_code: 500, error: String(e), response: { event_id: event.id, type: event.type },
    });
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 });
});
