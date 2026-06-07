// create-stripe-checkout — creates a real Stripe Checkout Session for a rental.
// Supports card, TWINT, Apple Pay & Google Pay (via Stripe payment methods).
// Returns the checkout URL which the kiosk renders as a QR code.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import { adminClient, logApi } from "../_shared/db.ts";

const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const APP_URL = Deno.env.get("PUBLIC_APP_URL") ?? "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const db = adminClient();

  try {
    const { rentalSessionId, origin } = await req.json();
    if (!rentalSessionId) {
      return new Response(JSON.stringify({ ok: false, error: "MISSING_SESSION" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: session } = await db.from("rental_sessions")
      .select("*").eq("id", rentalSessionId).maybeSingle();
    if (!session) {
      return new Response(JSON.stringify({ ok: false, error: "SESSION_NOT_FOUND" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!STRIPE_KEY) {
      return new Response(JSON.stringify({ ok: false, configured: false, error: "STRIPE_NOT_CONFIGURED" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const stripe = new Stripe(STRIPE_KEY, { apiVersion: "2024-12-18.acacia" });
    const base = APP_URL || origin || "";
    const amountCents = Math.round(Number(session.amount ?? 2.0) * 100);

    const checkout = await stripe.checkout.sessions.create({
      mode: "payment",
      // TWINT, Apple Pay & Google Pay are surfaced automatically with "card" +
      // "twint" when enabled in the Stripe dashboard for CHF.
      payment_method_types: ["card", "twint"],
      line_items: [{
        price_data: {
          currency: (session.currency ?? "CHF").toLowerCase(),
          product_data: { name: "Chargeurs.ch — Location batterie" },
          unit_amount: amountCents,
        },
        quantity: 1,
      }],
      metadata: {
        station_id: session.station_id,
        cabinet_id: session.cabinet_id ?? "",
        rental_session_id: session.id,
        apifox_trade_no: session.apifox_trade_no ?? "",
        selected_slot_num: session.selected_slot_num?.toString() ?? "",
      },
      success_url: `${base}/pay/${session.id}/success`,
      cancel_url: `${base}/pay/${session.id}/cancel`,
    }, { idempotencyKey: `checkout_${session.id}` });

    await logApi(db, {
      service: "stripe", endpoint: "checkout.sessions.create", method: "POST",
      status_code: 200, request: { rentalSessionId, amountCents },
      response: { id: checkout.id }, error: null,
    });

    await db.from("rental_sessions").update({
      stripe_checkout_session_id: checkout.id,
      checkout_url: checkout.url,
      state: "checkout_created",
    }).eq("id", session.id);

    await db.from("payments").insert({
      rental_session_id: session.id,
      stripe_session_id: checkout.id,
      amount: session.amount, currency: session.currency, status: "pending",
    });

    return new Response(JSON.stringify({ ok: true, checkout_url: checkout.url, checkout_id: checkout.id }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
