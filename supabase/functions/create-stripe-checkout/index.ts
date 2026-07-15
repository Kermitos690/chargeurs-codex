// create-stripe-checkout — creates or reuses the canonical Chargeurs.ch deposit
// Checkout. The kiosk must authenticate with its station-bound token. Trusted
// internal callers may use the service-role bearer token.
//
// Card / eligible wallets: 30 CHF authorization with manual capture.
// TWINT / automatic methods: 30 CHF prepayment with partial refund at return.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import {
  adminClient,
  logApi,
  auditLog,
  snapshotHash,
  verifyKioskDevice,
} from "../_shared/db.ts";

const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const APP_URL = Deno.env.get("PUBLIC_APP_URL") ?? "";
const EXPIRY_MINUTES = 30;
const REQUIRED_DEPOSIT_CENTS = 3_000;
const FLOW_ENABLED = (Deno.env.get("ENABLE_CANONICAL_SETTLEMENT_FLOW") ?? "false").toLowerCase() === "true";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return result === 0;
}

function isInternalServiceRequest(req: Request): boolean {
  const configured = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  return safeEqual(configured, bearer);
}

function appBase(origin: unknown): string | null {
  if (APP_URL) {
    try {
      return new URL(APP_URL).origin;
    } catch {
      return null;
    }
  }
  if (typeof origin !== "string") return null;
  let normalized: string;
  try {
    normalized = new URL(origin).origin;
  } catch {
    return null;
  }
  const allowed = (Deno.env.get("ALLOWED_APP_ORIGINS") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .flatMap((value) => {
      try { return [new URL(value).origin]; } catch { return []; }
    });
  return allowed.includes(normalized) ? normalized : null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  if (!FLOW_ENABLED) return json({ ok: false, error: "CANONICAL_SETTLEMENT_FLOW_DISABLED" }, 503);

  const db = adminClient();
  let rentalSessionId = "";

  try {
    const body = await req.json().catch(() => ({}));
    rentalSessionId = typeof body.rentalSessionId === "string" ? body.rentalSessionId.trim() : "";
    if (!UUID_RE.test(rentalSessionId)) return json({ ok: false, error: "INVALID_SESSION" }, 400);

    const { data: session, error: sessionError } = await db.from("rental_sessions")
      .select("*").eq("id", rentalSessionId).maybeSingle();
    if (sessionError) return json({ ok: false, error: "DATABASE_ERROR" }, 500);
    if (!session) return json({ ok: false, error: "SESSION_NOT_FOUND" }, 404);

    const base = appBase(body.origin);
    if (!base) return json({ ok: false, error: "PUBLIC_APP_URL_NOT_CONFIGURED" }, 503);

    if (!isInternalServiceRequest(req)) {
      const auth = await verifyKioskDevice(req, db, String(session.station_id));
      if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
      if (!session.kiosk_device_id || auth.device.id !== session.kiosk_device_id) {
        return json({ ok: false, error: "KIOSK_SESSION_MISMATCH" }, 403);
      }
    }

    if (!STRIPE_KEY) return json({ ok: false, configured: false, error: "STRIPE_NOT_CONFIGURED" }, 503);

    if (
      session.checkout_url &&
      session.checkout_url_expires_at &&
      new Date(session.checkout_url_expires_at).getTime() > Date.now() &&
      ["checkout_created", "created"].includes(session.state)
    ) {
      return json({
        ok: true,
        checkout_url: session.checkout_url,
        checkout_id: session.stripe_checkout_session_id,
        public_session_code: session.public_session_code,
        expires_at: session.checkout_url_expires_at,
        status: "awaiting_payment",
        deposit_cents: session.deposit_amount_cents ?? REQUIRED_DEPOSIT_CENTS,
        reused: true,
      });
    }

    if (!["created", "checkout_created", "payment_expired"].includes(session.state)) {
      return json({ ok: false, error: "INVALID_RENTAL_STATE", state: session.state }, 409);
    }

    const snapshot = (session.pricing_snapshot ?? null) as Record<string, unknown> | null;
    if (!snapshot || typeof snapshot !== "object") {
      await auditLog(db, { action: "pricing.error", target: session.id, data: { code: "MISSING_SNAPSHOT" } });
      return json({ ok: false, error: "PRICING_NOT_CONFIGURED" }, 409);
    }

    const recomputedHash = await snapshotHash(snapshot);
    if (session.pricing_snapshot_hash && recomputedHash !== session.pricing_snapshot_hash) {
      await auditLog(db, { action: "pricing.error", target: session.id, data: { code: "SNAPSHOT_HASH_MISMATCH" } });
      return json({ ok: false, error: "SNAPSHOT_INVALID" }, 409);
    }

    const snapshotCurrency = String(snapshot.currency ?? "").toUpperCase();
    const sessionCurrency = String(session.currency ?? "CHF").toUpperCase();
    if (sessionCurrency !== "CHF" || (snapshotCurrency && snapshotCurrency !== sessionCurrency)) {
      await auditLog(db, {
        action: "pricing.error",
        target: session.id,
        data: { code: "CURRENCY_MISMATCH", snapshotCurrency, sessionCurrency },
      });
      return json({ ok: false, error: "CURRENCY_MISMATCH" }, 409);
    }

    const depositCents = Number(snapshot.deposit_cents ?? Number.NaN);
    if (!Number.isInteger(depositCents) || depositCents !== REQUIRED_DEPOSIT_CENTS) {
      await auditLog(db, {
        action: "pricing.error",
        target: session.id,
        data: { code: "DEPOSIT_MISMATCH", observed: depositCents, required: REQUIRED_DEPOSIT_CENTS },
      });
      return json({ ok: false, error: "DEPOSIT_NOT_CONFIGURED" }, 409);
    }

    const stripe = new Stripe(STRIPE_KEY, {
      apiVersion: "2024-12-18.acacia",
      httpClient: Stripe.createFetchHttpClient(),
    });
    const expiresAtUnix = Math.floor(Date.now() / 1000) + EXPIRY_MINUTES * 60;
    const currency = sessionCurrency.toLowerCase();
    const pricingHash = String(session.pricing_snapshot_hash ?? recomputedHash);
    const metadata: Record<string, string> = {
      rental_session_id: String(session.id),
      public_session_code: String(session.public_session_code ?? ""),
      station_id: String(session.station_id ?? ""),
      kiosk_device_id: String(session.kiosk_device_id ?? ""),
      api_client_id: String(session.api_client_id ?? ""),
      cabinet_sn: String(session.cabinet_id ?? ""),
      shop_id: String(session.shop_id ?? ""),
      price_profile_id: String(session.price_profile_id ?? ""),
      price_profile_version: String(session.price_profile_version ?? ""),
      pricing_snapshot_hash: pricingHash,
      deposit_amount_cents: String(depositCents),
      expected_currency: currency,
      payment_purpose: "rental_deposit",
    };
    const previousAttempt = String(session.stripe_checkout_session_id ?? "initial").replace(/[^A-Za-z0-9_-]/g, "").slice(-80);

    const checkout = await stripe.checkout.sessions.create({
      mode: "payment",
      client_reference_id: String(session.id),
      customer_creation: "always",
      payment_intent_data: {
        description: "Chargeurs.ch — caution de location",
        metadata,
      },
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
    }, {
      idempotencyKey: `checkout_${session.id}_${previousAttempt}`,
    });

    if (!checkout.url) throw new Error("CHECKOUT_URL_MISSING");
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

    const { error: rentalUpdateError } = await db.from("rental_sessions").update({
      stripe_checkout_session_id: checkout.id,
      checkout_url: checkout.url,
      checkout_url_expires_at: expiresAtIso,
      state: "checkout_created",
      amount: depositCents / 100,
      amount_expected: depositCents / 100,
      deposit_amount_cents: depositCents,
      settlement_status: "pending",
      settlement_error: null,
    }).eq("id", session.id);
    if (rentalUpdateError) throw rentalUpdateError;

    const { error: paymentError } = await db.from("payments").upsert({
      rental_session_id: session.id,
      stripe_session_id: checkout.id,
      amount: depositCents / 100,
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
        api_client_id: session.api_client_id ?? null,
        price_profile_id: session.price_profile_id,
        price_profile_version: session.price_profile_version,
        deposit_cents: depositCents,
        currency,
        pricing_snapshot_hash: pricingHash,
        card_capture: "manual",
        twint_capture: "automatic",
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
      reused: false,
    });
  } catch (error) {
    await logApi(db, {
      service: "stripe",
      endpoint: "checkout.sessions.create",
      method: "POST",
      status_code: 500,
      request: { rentalSessionId },
      error: String(error),
    }).catch(() => {});
    return json({ ok: false, error: "CHECKOUT_ERROR" }, 500);
  }
});
