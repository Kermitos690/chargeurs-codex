// Stripe Terminal TEST backend for WisePad 3.
// Actions: connection_token | create_payment_intent.
// TEST-only. QR Checkout remains a parallel rail and pricing remains server-owned.
import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  canonicalTerminalAmountCents,
  canonicalTerminalCurrency,
  requireStripeTestKey,
  terminalBindingUsable,
  terminalIntentIdempotencyKey,
} from "../_shared/stripeTerminalTest.ts";

const headers = {
  ...corsHeaders,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-kiosk-token, x-idempotency-key",
  "Access-Control-Expose-Headers": "x-correlation-id",
};

const admin = () => createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

async function sha256(input: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function kioskAuth(req: Request, db: any, stationId: string) {
  const token = (req.headers.get("X-Kiosk-Token") ?? "").trim();
  if (token.length < 24) return null;
  const hash = await sha256(token);
  const { data } = await db.from("kiosk_devices")
    .select("id,station_id,active,token_revoked,token_expires_at")
    .eq("token_hash", hash)
    .maybeSingle();
  if (!data || data.station_id !== stationId || !data.active || data.token_revoked) return null;
  if (data.token_expires_at && Date.parse(data.token_expires_at) < Date.now()) return null;
  return data;
}

function stripeClient(secretKey: string) {
  return new Stripe(secretKey, {
    apiVersion: "2025-09-30.clover" as any,
    httpClient: Stripe.createFetchHttpClient(),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  const correlationId = crypto.randomUUID();
  const json = (body: Record<string, unknown>, status = 200) => new Response(
    JSON.stringify({ ...body, correlationId }),
    { status, headers: { ...headers, "Content-Type": "application/json", "X-Correlation-Id": correlationId } },
  );
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const db = admin();
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "";
    const rentalSessionId = typeof body.rentalSessionId === "string" ? body.rentalSessionId : "";
    if (!rentalSessionId) return json({ ok: false, error: "MISSING_SESSION" }, 400);
    if (!['connection_token','create_payment_intent'].includes(action)) return json({ ok: false, error: "INVALID_ACTION" }, 400);

    const { data: session, error: sessionError } = await db.from("rental_sessions").select("*").eq("id", rentalSessionId).maybeSingle();
    if (sessionError) throw sessionError;
    if (!session) return json({ ok: false, error: "SESSION_NOT_FOUND" }, 404);

    const stationId = String(session.station_id ?? "");
    const device = await kioskAuth(req, db, stationId);
    if (!device) return json({ ok: false, error: "KIOSK_AUTH_INVALID" }, 401);
    if (String(session.kiosk_device_id ?? "") !== String(device.id)) return json({ ok: false, error: "KIOSK_DEVICE_MISMATCH" }, 403);
    if (session.expires_at && Date.parse(session.expires_at) < Date.now()) return json({ ok: false, error: "SESSION_EXPIRED" }, 410);
    if (session.paid_at) return json({ ok: false, error: "SESSION_ALREADY_PAID" }, 409);

    const secretKey = (Deno.env.get("STRIPE_SECRET_KEY") ?? "").trim();
    if (!requireStripeTestKey(secretKey)) return json({ ok: false, error: "STRIPE_TEST_KEY_REQUIRED" }, 503);

    const { data: binding, error: bindingError } = await db.from("stripe_terminal_station_bindings")
      .select("station_id,stripe_location_id,stripe_reader_id,environment,enabled")
      .eq("station_id", stationId)
      .maybeSingle();
    if (bindingError) throw bindingError;
    if (!terminalBindingUsable(binding)) return json({ ok: false, error: "TERMINAL_NOT_CONFIGURED" }, 409);

    const stripe = stripeClient(secretKey);

    if (action === "connection_token") {
      const token = await stripe.terminal.connectionTokens.create({ location: String(binding.stripe_location_id) });
      await db.from("audit_logs").insert({
        action: "stripe.terminal.connection_token.created",
        target: rentalSessionId,
        data: {
          station_id: stationId,
          kiosk_device_id: device.id,
          stripe_location_id: binding.stripe_location_id,
          stripe_reader_id: binding.stripe_reader_id ?? null,
          environment: "test",
          correlation_id: correlationId,
        },
      }).then(() => {}, () => {});
      return json({
        ok: true,
        secret: token.secret,
        locationId: binding.stripe_location_id,
        expectedReaderId: binding.stripe_reader_id ?? null,
        environment: "test",
      });
    }

    // First initiated rail wins. This RPC serializes the decision on rental_sessions.
    const { error: railError } = await db.rpc("claim_rental_payment_rail", {
      p_rental_id: rentalSessionId,
      p_rail: "stripe_terminal",
      p_correlation_id: correlationId,
      p_metadata: { source: "stripe_terminal_backend", station_id: stationId },
    });
    if (railError) {
      const message = String(railError.message ?? "");
      if (message.includes("PAYMENT_RAIL_ALREADY_CLAIMED")) return json({ ok: false, error: "PAYMENT_RAIL_ALREADY_CLAIMED" }, 409);
      throw railError;
    }

    const amountCents = canonicalTerminalAmountCents(session);
    const currency = canonicalTerminalCurrency(session);
    if (!amountCents || !currency) return json({ ok: false, error: "PRICING_NOT_CONFIGURED" }, 409);
    const pricingHash = typeof session.pricing_snapshot_hash === "string" ? session.pricing_snapshot_hash : "";
    const idempotencyKey = terminalIntentIdempotencyKey(rentalSessionId, amountCents, pricingHash);

    const { data: existingAttempt, error: existingError } = await db.from("stripe_terminal_payment_attempts")
      .select("stripe_payment_intent_id,status,amount_cents,currency,stripe_location_id,stripe_reader_id")
      .eq("rental_session_id", rentalSessionId)
      .maybeSingle();
    if (existingError) throw existingError;

    if (existingAttempt?.stripe_payment_intent_id) {
      const existingIntent = await stripe.paymentIntents.retrieve(String(existingAttempt.stripe_payment_intent_id));
      return json({
        ok: true,
        reused: true,
        paymentIntentId: existingIntent.id,
        clientSecret: existingIntent.client_secret,
        status: existingIntent.status,
        amountCents: existingAttempt.amount_cents,
        currency: existingAttempt.currency,
        locationId: existingAttempt.stripe_location_id,
        expectedReaderId: existingAttempt.stripe_reader_id ?? null,
        environment: "test",
      });
    }

    const { error: attemptInsertError } = await db.from("stripe_terminal_payment_attempts").insert({
      rental_session_id: rentalSessionId,
      station_id: stationId,
      kiosk_device_id: device.id,
      stripe_location_id: binding.stripe_location_id,
      stripe_reader_id: binding.stripe_reader_id ?? null,
      amount_cents: amountCents,
      currency,
      status: "creating",
      idempotency_key: idempotencyKey,
      correlation_id: correlationId,
    });
    if (attemptInsertError && attemptInsertError.code !== "23505") throw attemptInsertError;

    const metadata: Record<string, string> = {
      rental_session_id: rentalSessionId,
      station_id: stationId,
      kiosk_device_id: String(device.id),
      stripe_terminal_location_id: String(binding.stripe_location_id),
      stripe_terminal_reader_id: String(binding.stripe_reader_id ?? ""),
      pricing_snapshot_hash: pricingHash,
      deposit_amount_cents: String(amountCents),
      payment_purpose: "rental_guarantee",
      payment_rail: "stripe_terminal",
      environment: "test",
    };

    const intent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency,
      payment_method_types: ["card_present"],
      capture_method: "manual",
      description: "Chargeurs.ch — garantie de location — Terminal TEST",
      metadata,
    }, { idempotencyKey });

    const { error: attemptUpdateError } = await db.from("stripe_terminal_payment_attempts").update({
      stripe_payment_intent_id: intent.id,
      status: intent.status,
      updated_at: new Date().toISOString(),
    }).eq("rental_session_id", rentalSessionId);
    if (attemptUpdateError) throw attemptUpdateError;

    const { error: sessionUpdateError } = await db.from("rental_sessions").update({
      stripe_payment_intent_id: intent.id,
      settlement_status: "pending",
      settlement_error: null,
      updated_at: new Date().toISOString(),
    }).eq("id", rentalSessionId).is("paid_at", null);
    if (sessionUpdateError) throw sessionUpdateError;

    await db.from("audit_logs").insert({
      action: "stripe.terminal.payment_intent.created",
      target: rentalSessionId,
      data: {
        stripe_payment_intent_id: intent.id,
        station_id: stationId,
        kiosk_device_id: device.id,
        stripe_location_id: binding.stripe_location_id,
        stripe_reader_id: binding.stripe_reader_id ?? null,
        amount_cents: amountCents,
        currency,
        pricing_snapshot_hash: pricingHash,
        capture_method: "manual",
        payment_method_types: ["card_present"],
        environment: "test",
        correlation_id: correlationId,
      },
    }).then(() => {}, () => {});

    return json({
      ok: true,
      reused: false,
      paymentIntentId: intent.id,
      clientSecret: intent.client_secret,
      status: intent.status,
      amountCents,
      currency,
      locationId: binding.stripe_location_id,
      expectedReaderId: binding.stripe_reader_id ?? null,
      environment: "test",
    });
  } catch (error) {
    const raw = error as any;
    console.error("stripe-terminal-backend", {
      code: raw?.code ?? null,
      message: String(raw?.message ?? "TERMINAL_BACKEND_FAILED").slice(0, 500),
      correlationId,
    });
    return json({ ok: false, error: "STRIPE_TERMINAL_BACKEND_FAILED" }, 500);
  }
});
