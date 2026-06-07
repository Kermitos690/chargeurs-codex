// stripe-webhook — verifies Stripe signature, records payment, validates the
// paid amount/currency against the rental session, and ONLY on confirmed
// success triggers ChargeNow order + battery ejection. Never ejects on
// redirect/success_url. Idempotent via webhook_events(external_id unique).
import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import { adminClient, logApi } from "../_shared/db.ts";

const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";

async function fulfil(db: ReturnType<typeof adminClient>, cs: Stripe.Checkout.Session, event: Stripe.Event) {
  const rentalSessionId = cs.metadata?.rental_session_id;
  if (!rentalSessionId) return;

  const { data: session } = await db.from("rental_sessions")
    .select("*").eq("id", rentalSessionId).maybeSingle();
  if (!session) return;

  // Amount + currency verification.
  const expectedCents = Math.round(Number(session.amount_expected ?? session.amount ?? 0) * 100);
  const paidCents = Number(cs.amount_total ?? 0);
  const expectedCur = (session.currency ?? "CHF").toLowerCase();
  const paidCur = (cs.currency ?? "").toLowerCase();
  const amountOk = expectedCents === 0 || paidCents === expectedCents;
  const currencyOk = !paidCur || paidCur === expectedCur;
  const paid = cs.payment_status === "paid";

  await db.from("payments").update({
    status: paid ? "succeeded" : "pending",
    stripe_payment_intent_id: cs.payment_intent as string,
    payment_method: (cs.payment_method_types ?? []).join(","),
    raw_webhook: { id: event.id, type: event.type },
  }).eq("stripe_session_id", cs.id);

  if (!paid) return;

  if (!amountOk || !currencyOk) {
    await db.from("rental_sessions").update({
      state: "needs_support", failure_code: "AMOUNT_MISMATCH",
      failure_message: `Montant payé ${paidCents} ${paidCur} ≠ attendu ${expectedCents} ${expectedCur}.`,
    }).eq("id", session.id);
    return;
  }

  // Idempotent transition to payment_succeeded.
  const { data: updated } = await db.from("rental_sessions").update({
    state: "payment_succeeded",
    stripe_payment_intent_id: cs.payment_intent as string,
    stripe_customer_id: (cs.customer as string) ?? null,
    stripe_payment_method_type: (cs.payment_method_types ?? [])[0] ?? null,
    amount_paid: paidCents / 100,
    paid_at: new Date().toISOString(),
  }).eq("id", session.id).in("state", ["checkout_created", "created", "payment_processing"]).select();

  // Trigger ChargeNow order + ejection ONLY once, after confirmed payment.
  if (updated && updated.length > 0) {
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

  const stripe = new Stripe(STRIPE_KEY, { apiVersion: "2024-12-18.acacia" });
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, sig!, WEBHOOK_SECRET);
  } catch (e) {
    return new Response(JSON.stringify({ error: "INVALID_SIGNATURE", detail: String(e) }), { status: 400 });
  }

  // Idempotency guard (unique external_id).
  const { error: dupErr } = await db.from("webhook_events").insert({
    provider: "stripe", external_id: event.id, event_type: event.type, payload: { type: event.type },
  });
  if (dupErr) {
    return new Response(JSON.stringify({ received: true, duplicate: true }), { status: 200 });
  }

  await logApi(db, { service: "stripe", endpoint: "webhook", method: "POST", status_code: 200, response: { type: event.type } });

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        await fulfil(db, event.data.object as Stripe.Checkout.Session, event);
        break;

      case "checkout.session.async_payment_failed": {
        const cs = event.data.object as Stripe.Checkout.Session;
        if (cs.metadata?.rental_session_id) {
          await db.from("rental_sessions").update({
            state: "payment_failed", failure_code: "ASYNC_PAYMENT_FAILED",
            failure_message: "Le paiement asynchrone a échoué.",
          }).eq("id", cs.metadata.rental_session_id);
        }
        break;
      }

      case "checkout.session.expired": {
        const cs = event.data.object as Stripe.Checkout.Session;
        if (cs.metadata?.rental_session_id) {
          await db.from("rental_sessions").update({ state: "payment_expired" })
            .eq("id", cs.metadata.rental_session_id)
            .in("state", ["checkout_created", "created"]);
        }
        break;
      }

      case "payment_intent.payment_failed": {
        const pi = event.data.object as Stripe.PaymentIntent;
        await db.from("rental_sessions").update({
          state: "payment_failed", failure_code: "PAYMENT_INTENT_FAILED",
          failure_message: pi.last_payment_error?.message ?? "Paiement refusé.",
        }).eq("stripe_payment_intent_id", pi.id).in("state", ["checkout_created", "created", "payment_processing"]);
        break;
      }

      case "charge.refunded": {
        const ch = event.data.object as Stripe.Charge;
        const piId = ch.payment_intent as string;
        if (piId) {
          await db.from("payments").update({
            status: "refunded", refund_id: ch.id, refunded_at: new Date().toISOString(),
          }).eq("stripe_payment_intent_id", piId);
          await db.from("rental_sessions").update({ state: "refunded" })
            .eq("stripe_payment_intent_id", piId);
        }
        break;
      }
      default:
        break;
    }
  } catch (e) {
    await logApi(db, { service: "stripe", endpoint: "webhook:handle", method: "POST", status_code: 500, error: String(e) });
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 });
});
