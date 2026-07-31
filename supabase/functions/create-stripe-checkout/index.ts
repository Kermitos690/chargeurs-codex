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
import { appendRentalEvent, OrchestratorError } from "../_shared/rentalOrchestratorRuntime.ts";
import { computeFinalPricingFromSnapshot, PricingSnapshotError } from "../_shared/pricingSnapshot.ts";
import { validateStripeTestRuntime } from "../_shared/stripeRuntimeConfig.ts";

const APP_URL = Deno.env.get("PUBLIC_APP_URL") ?? "";
const EXPIRY_MINUTES = 30;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

function configuredAppUrl(): string | null {
  try {
    const url = new URL(APP_URL);
    if (url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const db = adminClient();
  let rentalSessionId = "";

  try {
    const body = await req.json().catch(() => ({}));
    rentalSessionId = typeof body.rentalSessionId === "string" ? body.rentalSessionId : "";
    if (!rentalSessionId) return json({ ok: false, error: "MISSING_SESSION" }, 400);

    const { data: session, error: sessionError } = await db.from("rental_sessions")
      .select("*").eq("id", rentalSessionId).maybeSingle();
    if (sessionError) throw sessionError;
    if (!session) return json({ ok: false, error: "SESSION_NOT_FOUND" }, 404);

    const stripeRuntime = validateStripeTestRuntime();
    if (!stripeRuntime.ok) {
      return json({ ok: false, configured: false, error: stripeRuntime.error }, 503);
    }

    const base = configuredAppUrl();
    if (!base) return json({ ok: false, configured: false, error: "PUBLIC_APP_URL_NOT_CONFIGURED" }, 503);

    const snap = (session.pricing_snapshot ?? null) as Record<string, unknown> | null;
    if (!snap || typeof snap !== "object") {
      await auditLog(db, { action: "pricing.error", target: session.id, data: { code: "MISSING_SNAPSHOT" } });
      return json({ ok: false, error: "PRICING_NOT_CONFIGURED" }, 409);
    }

    const storedHash = typeof session.pricing_snapshot_hash === "string"
      ? session.pricing_snapshot_hash
      : "";
    const recomputedHash = await snapshotHash(snap);
    if (!storedHash || recomputedHash !== storedHash) {
      await auditLog(db, { action: "pricing.error", target: session.id, data: { code: "SNAPSHOT_HASH_MISMATCH" } });
      return json({ ok: false, error: "SNAPSHOT_INVALID" }, 409);
    }

    const snapCurrency = String(snap.currency ?? "").toUpperCase();
    const sessCurrency = String(session.currency ?? "CHF").toUpperCase();
    if (snapCurrency && snapCurrency !== sessCurrency) {
      await auditLog(db, {
        action: "pricing.error",
        target: session.id,
        data: { code: "CURRENCY_MISMATCH", snapCurrency, sessCurrency },
      });
      return json({ ok: false, error: "CURRENCY_MISMATCH" }, 409);
    }
    if (
      (session.price_profile_id && String(snap.profile_id ?? "") !== String(session.price_profile_id)) ||
      (session.price_profile_version != null && Number(snap.profile_version) !== Number(session.price_profile_version))
    ) {
      await auditLog(db, { action: "pricing.error", target: session.id, data: { code: "SNAPSHOT_BINDING_MISMATCH" } });
      return json({ ok: false, error: "SNAPSHOT_INVALID" }, 409);
    }

    try {
      const validationTime = String(session.created_at ?? new Date().toISOString());
      computeFinalPricingFromSnapshot({
        snapshot: snap,
        expectedCurrency: sessCurrency,
        startAt: validationTime,
        endAt: validationTime,
        returnState: "normal",
      });
    } catch (error) {
      const code = error instanceof PricingSnapshotError ? error.code : "SNAPSHOT_INVALID";
      await auditLog(db, { action: "pricing.error", target: session.id, data: { code } });
      return json({ ok: false, error: "SNAPSHOT_INVALID" }, 409);
    }

    const depositCents = Number(snap.deposit_cents ?? NaN);
    if (!Number.isInteger(depositCents) || depositCents <= 0) {
      await auditLog(db, { action: "pricing.error", target: session.id, data: { code: "DEPOSIT_NOT_CONFIGURED" } });
      return json({ ok: false, error: "DEPOSIT_NOT_CONFIGURED" }, 409);
    }

    const pricingHash = storedHash;
    const paymentEventKey = `payment_started:${session.id}:${pricingHash}`;
    await appendRentalEvent(db, {
      rentalId: String(session.id),
      eventType: "payment_started",
      idempotencyKey: paymentEventKey,
      stationId: String(session.station_id ?? "") || null,
      metadata: {
        pricingSnapshotHash: pricingHash,
        depositAmountCents: depositCents,
        currency: sessCurrency,
      },
    });

    if (
      session.checkout_url &&
      session.checkout_url_expires_at &&
      new Date(session.checkout_url_expires_at).getTime() > Date.now() &&
      ["checkout_created", "created", "payment_pending"].includes(String(session.state))
    ) {
      return json({
        ok: true,
        checkout_url: session.checkout_url,
        public_session_code: session.public_session_code,
        expires_at: session.checkout_url_expires_at,
        status: "awaiting_payment",
        deposit_cents: depositCents,
      });
    }

    const stripe = new Stripe(stripeRuntime.secretKey, {
      apiVersion: "2024-12-18.acacia",
      httpClient: Stripe.createFetchHttpClient(),
    });

    const amount = depositCents / 100;
    const currency = sessCurrency.toLowerCase();
    const expiresAtUnix = Math.floor(Date.now() / 1000) + EXPIRY_MINUTES * 60;

    const metadata: Record<string, string> = {
      rental_session_id: String(session.id),
      public_session_code: String(session.public_session_code ?? ""),
      station_id: String(session.station_id ?? ""),
      kiosk_device_id: String(session.kiosk_device_id ?? ""),
      cabinet_sn: String(session.cabinet_id ?? ""),
      shop_id: String(session.shop_id ?? ""),
      price_profile_id: String(session.price_profile_id ?? ""),
      price_profile_version: String(session.price_profile_version ?? ""),
      pricing_snapshot_hash: pricingHash,
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
      // overridden to manual capture; automatically captured methods are
      // settled through the prepaid/refund strategy after webhook confirmation.
      payment_method_options: {
        card: {
          capture_method: "manual",
          setup_future_usage: "off_session",
          request_extended_authorization: "if_available",
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
    }, {
      idempotencyKey: `rental_deposit_checkout:${session.id}:${pricingHash}`,
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

    // Legacy fields remain a compatibility projection for the current UI. The
    // canonical payment_started transition is already persisted above.
    const { error: rentalUpdateError } = await db.from("rental_sessions").update({
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
    if (rentalUpdateError) throw rentalUpdateError;

    const { error: paymentError } = await db.from("payments").upsert({
      rental_session_id: session.id,
      stripe_session_id: checkout.id,
      amount,
      currency: session.currency,
      status: "pending",
      amount_authorized_cents: 0,
      amount_captured_cents: 0,
      amount_refunded_cents: 0,
    }, { onConflict: "stripe_session_id" });
    if (paymentError) throw paymentError;

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
        automatic_methods: "prepaid_refund",
      },
    });

    return json({
      ok: true,
      checkout_url: checkout.url,
      checkout_id: checkout.id,
      public_session_code: session.public_session_code,
      expires_at: expiresAtIso,
      status: "awaiting_payment",
      deposit_cents: depositCents,
    });
  } catch (error) {
    const code = error instanceof OrchestratorError ? error.code : "STRIPE_CHECKOUT_FAILED";
    console.error("create-stripe-checkout failed", code);
    if (rentalSessionId) {
      await auditLog(db, {
        action: "stripe.checkout.failed",
        target: rentalSessionId,
        data: { code },
      }).catch(() => {});
    }
    const status = error instanceof OrchestratorError ? 409 : 500;
    return json({ ok: false, error: code }, status);
  }
});
