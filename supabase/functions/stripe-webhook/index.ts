// stripe-webhook — verifies Stripe signature, records payment, and ONLY on
// confirmed payment success triggers battery ejection. Never ejects on
// redirect success_url alone. Idempotent via webhook_events table.
import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import { adminClient, logApi } from "../_shared/db.ts";

const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";

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

  // Idempotency guard
  const { error: dupErr } = await db.from("webhook_events").insert({
    provider: "stripe", external_id: event.id, event_type: event.type, payload: event as unknown as object,
  });
  if (dupErr) {
    // already processed (unique violation)
    return new Response(JSON.stringify({ received: true, duplicate: true }), { status: 200 });
  }

  await logApi(db, { service: "stripe", endpoint: "webhook", method: "POST", status_code: 200, response: { type: event.type } });

  if (event.type === "checkout.session.completed") {
    const cs = event.data.object as Stripe.Checkout.Session;
    const rentalSessionId = cs.metadata?.rental_session_id;
    const paid = cs.payment_status === "paid";

    if (rentalSessionId) {
      await db.from("payments").update({
        status: paid ? "succeeded" : "pending",
        stripe_payment_intent_id: cs.payment_intent as string,
        payment_method: (cs.payment_method_types ?? []).join(","),
        raw_webhook: event as unknown as object,
      }).eq("stripe_session_id", cs.id);

      if (paid) {
        await db.from("rental_sessions").update({
          state: "payment_succeeded",
          stripe_payment_intent_id: cs.payment_intent as string,
          paid_at: new Date().toISOString(),
        }).eq("id", rentalSessionId);

        // Trigger ejection ONLY after confirmed payment.
        try {
          await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/eject-after-payment`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            },
            body: JSON.stringify({ rentalSessionId }),
          });
        } catch (_) { /* ejection function logs its own errors */ }
      }
    }
  }

  if (event.type === "checkout.session.expired") {
    const cs = event.data.object as Stripe.Checkout.Session;
    if (cs.metadata?.rental_session_id) {
      await db.from("rental_sessions").update({ state: "payment_expired" })
        .eq("id", cs.metadata.rental_session_id);
    }
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 });
});
