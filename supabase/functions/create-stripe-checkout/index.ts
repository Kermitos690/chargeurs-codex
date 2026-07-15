// create-stripe-checkout — creates a hosted Stripe Checkout Session for the
// server-computed deposit. The kiosk renders the returned URL as a QR code.
//
// Settlement is payment-method aware:
//  - card / Apple Pay / Google Pay: manual capture (30 CHF hold, capture later)
//  - TWINT: automatic capture (30 CHF prepaid, unused balance refunded later)
//
// The deposit, currency and pricing profile are taken only from the frozen
// server-side pricing snapshot. No amount supplied by the browser is trusted.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import { adminClient, logApi, auditLog, snapshotHash } from "../_shared/db.ts";

const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const APP_URL = Deno.env.get("PUBLIC_APP_URL") ?? "";
const EXPIRY_MINUTES = 30;

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

    if (session.checkout_url && session.checkout_url_expires_at &&
        new Date(session.checkout_url_expires_at).getTime() > Date.now() &&
        ["checkout_created", "created"].includes(session.state)) {
      return new Response(JSON.stringify({
        ok: true,
        checkout_url: session.checkout_url,
        public_session_code: session.public_session_code,
        expires_at: session.checkout_url_expires_at,
        status: "awaiting_payment",
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const stripe = new Stripe(STRIPE_KEY, {
      apiVersion: "2024-12-18.acacia",
      httpClient: Stripe.createFetchHttpClient(),
    });
    const base = APP_URL || origin || "";

    const snap = (session.pricing_snapshot ?? null) as Record<string, unknown> | null;
    if (!snap || typeof snap !== "object") {
      await auditLog(db, { action: "pricing.error", target: session.id, data: { code: "MISSING_SNAPSHOT" } });
      return new Response(JSON.stringify({ ok: false, error: "PRICING_NOT_CONFIGURED" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const recomputedHash = await snapshotHash(snap);
    if (session.pricing_snapshot_hash && recomputedHash !== session.pricing_snapshot_hash) {
      await auditLog(db, { action: "pricing.error", target: session.id, data: { code: "SNAPSHOT_HASH_MISMATCH" } });
      return new Response(JSON.stringify({ ok: false, error: "SNAPSHOT_INVALID" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const snapCurrency = String(snap.currency ?? "").toUpperCase();
    const sessCurrency = String(session.currency ?? "CHF").toUpperCase();
    if (snapCurrency && snapCurrency !== sessCurrency) {
      await auditLog(db, {
        action: "pricing.error",
        target: session.id,
        data: { code: "CURRENCY_MISMATCH", snapCurrency, sessCurrency },
      });
      return new Response(JSON.stringify({ ok: false, error: "CURRENCY_MISMATCH" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const depositCents = Number(snap.deposit_cents ?? NaN);
    if (!Number.isInteger(depositCents) || depositCents <= 0) {
      await auditLog(db, { action: "pricing.error", target: session.id, data: { code: "DEPOSIT_NOT_CONFIGURED" } });
      return new Response(JSON.stringify({ ok: false, error: "DEPOSIT_NOT_CONFIGURED" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const amount = depositCents / 100;
    const currency = sessCurrency.toLowerCase();
    const expiresAtUnix = Math.floor(Date.now() / 1000) + EXPIRY_MINUTES * 60;
    const pricingHash = session.pricing_snapshot_hash ?? recomputedHash;

    const metadata: Record<string, string> = {
      rental_session_id: String(session.id),
      public_session_code: String(session.public_session_code ?? ""),
      station_id: String(session.station_id ?? ""),
      kiosk_device_id: String(session.kiosk_device_id ?? ""),
      cabinet_sn: String(session.cabinet_id ?? ""),
      shop_id: String(session.shop_id ?? ""),
      price_profile_id: String(session.price_profile_id ?? ""),
      price_profile_version: String(session.price_profile_version ?? ""),
      pricing_snapshot_hash: String(pricingHash),
      deposit_amount_cents: String(depositCents),
      expected_currency: currency,
      payment_purpose: "rental_deposit",
    };

    const checkout = await stripe.checkout.sessions.create({
      mode: "payment",
      client_reference_id: String(session.id),
      customer_creation: "always",
      payment_intent_data: {
        description: "Chargeurs.ch — caution de location",
        metadata,
      },
      // Dashboard-managed dynamic payment methods remain active. Card is
      // overridden to manual capture; TWINT stays automatically captured.
      payment_method_options: {
        card: {
          capture_method: "manual",
          setup_future_usage: "off_session",
          request_extended_authorization: "if_available",
        },
        twint: {
          setup_future_usage: "off_session",
        },
      },
      expires_at: expiresAtUnix,
      line_items: [{
        price_data: {
          currency,
          product_data: {
            name: "Chargeurs.ch — Caution de location",
            description: "Le montant final est calculé au retour de la batterie.",
          },
          unit_amount: depositCents,
        },
        quantity: 1,
      }],
      metadata,
      success_url: `${base}/pay/${session.id}/success?c=${encodeURIComponent(session.public_session_code ?? "")}`,
      cancel_url: `${base}/pay/${session.id}/cancel?c=${encodeURIComponent(session.public_session_code ?? "")}`,
    });

    const expiresAtIso = new Date(expiresAtUnix * 1000).toISOString();

    await logApi(db, {
      service: "stripe",
      endpoint: "checkout.sessions.create",
      method: "POST",
      status_code: 200,
      request: { rentalSessionId, depositCents },
      response: { id: checkout.id },
      error: null,
    });

    await db.from("rental_sessions").update({
      stripe_checkout_session_id: checkout.id,
      checkout_url: checkout.url,
      checkout_url_expires_at: expiresAtIso,
      state: "checkout_created",
      amount,
      amount_expected: amount,
      deposit_amount_cents: depositCents,
      settlement_status: "pending",
      settlement_error: null,
    }).eq("id", session.id);

    await db.from("payments").upsert({
      rental_session_id: session.id,
      stripe_session_id: checkout.id,
      amount,
      currency: session.currency,
      status: "pending",
      amount_authorized_cents: 0,
      amount_captured_cents: 0,
      amount_refunded_cents: 0,
    }, { onConflict: "stripe_session_id" });

    await auditLog(db, {
      action: "stripe.checkout.created",
      target: session.id,
      data: {
        stripe_checkout_session_id: checkout.id,
        station_id: session.station_id,
        kiosk_device_id: session.kiosk_device_id ?? null,
        price_profile_id: session.price_profile_id,
        price_profile_version: session.price_profile_version,
        deposit_cents: depositCents,
        currency,
        pricing_snapshot_hash: pricingHash,
        card_capture: "manual",
        twint_capture: "automatic",
      },
    });

    return new Response(JSON.stringify({
      ok: true,
      checkout_url: checkout.url,
      checkout_id: checkout.id,
      public_session_code: session.public_session_code,
      expires_at: expiresAtIso,
      status: "awaiting_payment",
      deposit_cents: depositCents,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
