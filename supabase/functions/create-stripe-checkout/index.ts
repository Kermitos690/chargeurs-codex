// create-stripe-checkout — creates or reuses a hosted Stripe Checkout Session.
// A kiosk request must present its station-bound X-Kiosk-Token. Internal callers
// (Platform API / trusted Edge Functions) must use the service-role bearer token.
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

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index++) result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return result === 0;
}

function isInternalServiceRequest(req: Request): boolean {
  const configured = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  return Boolean(configured && bearer && safeEqual(configured, bearer));
}

function appBase(origin: unknown): string | null {
  if (APP_URL) return APP_URL.replace(/\/+$/, "");
  if (typeof origin !== "string") return null;
  let normalized: string;
  try {
    normalized = new URL(origin).origin;
  } catch {
    return null;
  }
  const allowed = (Deno.env.get("ALLOWED_APP_ORIGINS") ?? "")
    .split(",")
    .map((value) => value.trim().replace(/\/+$/, ""))
    .filter(Boolean);
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
  const db = adminClient();

  try {
    const body = await req.json().catch(() => ({}));
    const rentalSessionId = typeof body.rentalSessionId === "string" ? body.rentalSessionId : "";
    if (!rentalSessionId) return json({ ok: false, error: "MISSING_SESSION" }, 400);

    const { data: session } = await db.from("rental_sessions")
      .select("*").eq("id", rentalSessionId).maybeSingle();
    if (!session) return json({ ok: false, error: "SESSION_NOT_FOUND" }, 404);

    if (!isInternalServiceRequest(req)) {
      const auth = await verifyKioskDevice(req, db, String(session.station_id));
      if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
      if (!session.kiosk_device_id || auth.device.id !== session.kiosk_device_id) {
        return json({ ok: false, error: "KIOSK_SESSION_MISMATCH" }, 403);
      }
    }

    if (!STRIPE_KEY) return json({ ok: false, configured: false, error: "STRIPE_NOT_CONFIGURED" }, 503);
    const base = appBase(body.origin);
    if (!base) return json({ ok: false, error: "PUBLIC_APP_URL_NOT_CONFIGURED" }, 503);

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
    if (snapshotCurrency && snapshotCurrency !== sessionCurrency) {
      await auditLog(db, {
        action: "pricing.error",
        target: session.id,
        data: { code: "CURRENCY_MISMATCH", snapshotCurrency, sessionCurrency },
      });
      return json({ ok: false, error: "CURRENCY_MISMATCH" }, 409);
    }

    const finalCents = Number(snapshot.final_cents ?? Number.NaN);
    const expectedCents = Math.round(Number(session.amount_expected ?? 0) * 100);
    if (!Number.isFinite(finalCents) || finalCents <= 0 || finalCents !== expectedCents) {
      await auditLog(db, {
        action: "pricing.error",
        target: session.id,
        data: { code: "AMOUNT_MISMATCH", finalCents, expectedCents },
      });
      return json({ ok: false, error: "PRICING_NOT_CONFIGURED" }, 409);
    }

    const stripe = new Stripe(STRIPE_KEY, {
      apiVersion: "2024-12-18.acacia",
      httpClient: Stripe.createFetchHttpClient(),
    });
    const expiresAtUnix = Math.floor(Date.now() / 1000) + EXPIRY_MINUTES * 60;
    const currency = sessionCurrency.toLowerCase();

    const checkout = await stripe.checkout.sessions.create({
      mode: "payment",
      expires_at: expiresAtUnix,
      line_items: [{
        price_data: {
          currency,
          product_data: { name: "Chargeurs.ch — Location batterie" },
          unit_amount: finalCents,
        },
        quantity: 1,
      }],
      metadata: {
        rental_session_id: session.id,
        public_session_code: session.public_session_code ?? "",
        station_id: session.station_id,
        kiosk_device_id: session.kiosk_device_id ?? "",
        api_client_id: session.api_client_id ?? "",
        cabinet_sn: session.cabinet_id ?? "",
        shop_id: session.shop_id ?? "",
        price_profile_id: session.price_profile_id ?? "",
        price_profile_version: String(session.price_profile_version ?? ""),
        pricing_snapshot_hash: session.pricing_snapshot_hash ?? recomputedHash,
        expected_amount: String(finalCents / 100),
        expected_currency: currency,
      },
      success_url: `${base}/pay/${session.id}/success?c=${encodeURIComponent(session.public_session_code ?? "")}`,
      cancel_url: `${base}/pay/${session.id}/cancel?c=${encodeURIComponent(session.public_session_code ?? "")}`,
    }, {
      idempotencyKey: `checkout_${session.id}`,
    });

    const expiresAtIso = new Date(expiresAtUnix * 1000).toISOString();
    await logApi(db, {
      service: "stripe",
      endpoint: "checkout.sessions.create",
      method: "POST",
      status_code: 200,
      request: { rentalSessionId, amountCents: finalCents },
      response: { id: checkout.id },
      error: null,
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
      amount: finalCents / 100,
      currency: session.currency,
      status: "pending",
    }, { onConflict: "stripe_session_id" });

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
        amount_cents: finalCents,
        currency,
        pricing_snapshot_hash: session.pricing_snapshot_hash ?? recomputedHash,
      },
    });

    return json({
      ok: true,
      checkout_url: checkout.url,
      checkout_id: checkout.id,
      public_session_code: session.public_session_code,
      expires_at: expiresAtIso,
      status: "awaiting_payment",
      reused: false,
    });
  } catch (error) {
    return json({ ok: false, error: "CHECKOUT_ERROR", detail: String(error) }, 500);
  }
});
