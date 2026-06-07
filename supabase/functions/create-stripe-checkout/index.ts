// create-stripe-checkout — creates a real hosted Stripe Checkout Session.
// The kiosk renders the returned URL as a QR code. Supports card + TWINT
// (Apple Pay / Google Pay surface automatically via "card" when eligible).
// The amount is taken from the server-side rental_session.amount_expected.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import { adminClient, logApi } from "../_shared/db.ts";

const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const APP_URL = Deno.env.get("PUBLIC_APP_URL") ?? "";
const EXPIRY_MINUTES = 30; // Stripe minimum 30 min for hosted Checkout.

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

    // Reuse a still-valid checkout instead of creating a duplicate.
    if (session.checkout_url && session.checkout_url_expires_at &&
        new Date(session.checkout_url_expires_at).getTime() > Date.now() &&
        ["checkout_created", "created"].includes(session.state)) {
      return new Response(JSON.stringify({
        ok: true, checkout_url: session.checkout_url,
        public_session_code: session.public_session_code,
        expires_at: session.checkout_url_expires_at, status: "awaiting_payment",
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const stripe = new Stripe(STRIPE_KEY, {
      apiVersion: "2024-12-18.acacia",
      httpClient: Stripe.createFetchHttpClient(),
    });
    const base = APP_URL || origin || "";
    // Price is server-side ONLY.
    const amount = Number(session.amount_expected ?? session.amount ?? 2.0);
    const amountCents = Math.round(amount * 100);
    const currency = (session.currency ?? "CHF").toLowerCase();
    const expiresAtUnix = Math.floor(Date.now() / 1000) + EXPIRY_MINUTES * 60;

    const checkout = await stripe.checkout.sessions.create({
      mode: "payment",
      // TWINT + card. Apple Pay / Google Pay are surfaced by Stripe under "card"
      // when the buyer's device/wallet/country/account are eligible.
      payment_method_types: ["card", "twint"],
      expires_at: expiresAtUnix,
      line_items: [{
        price_data: {
          currency,
          product_data: { name: "Chargeurs.ch — Location batterie" },
          unit_amount: amountCents,
        },
        quantity: 1,
      }],
      metadata: {
        rental_session_id: session.id,
        public_session_code: session.public_session_code ?? "",
        station_id: session.station_id,
        cabinet_sn: session.cabinet_id ?? "",
        shop_id: session.shop_id ?? "",
        price_profile_id: session.price_profile_id ?? "",
        expected_amount: String(amount),
        expected_currency: currency,
      },
      success_url: `${base}/pay/${session.id}/success`,
      cancel_url: `${base}/pay/${session.id}/cancel`,
    });

    const expiresAtIso = new Date(expiresAtUnix * 1000).toISOString();

    await logApi(db, {
      service: "stripe", endpoint: "checkout.sessions.create", method: "POST",
      status_code: 200, request: { rentalSessionId, amountCents },
      response: { id: checkout.id }, error: null,
    });

    await db.from("rental_sessions").update({
      stripe_checkout_session_id: checkout.id,
      checkout_url: checkout.url,
      checkout_url_expires_at: expiresAtIso,
      state: "checkout_created",
    }).eq("id", session.id);

    await db.from("payments").upsert({
      rental_session_id: session.id,
      stripe_session_id: checkout.id,
      amount: amount, currency: session.currency, status: "pending",
    }, { onConflict: "stripe_session_id" });

    return new Response(JSON.stringify({
      ok: true, checkout_url: checkout.url, checkout_id: checkout.id,
      public_session_code: session.public_session_code,
      expires_at: expiresAtIso, status: "awaiting_payment",
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
