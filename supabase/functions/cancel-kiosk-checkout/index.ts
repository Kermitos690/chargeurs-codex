// cancel-kiosk-checkout — explicit customer cancellation before payment only.
//
// The kiosk may return to the three-choice home only after the real Stripe
// Checkout has been expired. This endpoint is fail-closed once any payment,
// authorization, release or completed-rental evidence exists.
import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const headers = {
  ...corsHeaders,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-kiosk-token",
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

async function authenticateKiosk(req: Request, db: ReturnType<typeof admin>, stationId: string) {
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  const correlationId = crypto.randomUUID();
  const reply = (body: Record<string, unknown>, status = 200) => new Response(
    JSON.stringify({ ...body, correlationId }),
    { status, headers: { ...headers, "Content-Type": "application/json", "X-Correlation-Id": correlationId } },
  );
  if (req.method !== "POST") return reply({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const rentalSessionId = typeof body.rentalSessionId === "string" ? body.rentalSessionId.trim() : "";
    if (!/^[0-9a-f-]{36}$/i.test(rentalSessionId)) return reply({ ok: false, error: "INVALID_SESSION" }, 400);

    const db = admin();
    const { data: session, error: sessionError } = await db.from("rental_sessions")
      .select("id,station_id,kiosk_device_id,state,paid_at,ejected_at,returned_at,completed_at,stripe_checkout_session_id,public_session_code")
      .eq("id", rentalSessionId)
      .maybeSingle();
    if (sessionError) throw sessionError;
    if (!session) return reply({ ok: false, error: "SESSION_NOT_FOUND" }, 404);

    const stationId = String(session.station_id ?? "");
    const kiosk = await authenticateKiosk(req, db, stationId);
    if (!kiosk) return reply({ ok: false, error: "KIOSK_AUTH_INVALID" }, 401);
    if (String(session.kiosk_device_id ?? "") !== String(kiosk.id)) {
      return reply({ ok: false, error: "KIOSK_DEVICE_MISMATCH" }, 403);
    }

    if (!["created", "checkout_created"].includes(String(session.state ?? ""))
      || session.paid_at || session.ejected_at || session.returned_at || session.completed_at) {
      return reply({ ok: false, error: "CHECKOUT_CANCELLATION_NOT_ALLOWED" }, 409);
    }

    const { data: payment, error: paymentError } = await db.from("payments")
      .select("status,amount_authorized_cents,amount_captured_cents,amount_refunded_cents,stripe_payment_intent_id")
      .eq("rental_session_id", rentalSessionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (paymentError) throw paymentError;

    const authorized = Number(payment?.amount_authorized_cents ?? 0);
    const captured = Number(payment?.amount_captured_cents ?? 0);
    const refunded = Number(payment?.amount_refunded_cents ?? 0);
    const financialState = String(payment?.status ?? "pending");
    if (authorized > 0 || captured > 0 || refunded > 0 || payment?.stripe_payment_intent_id
      || ["authorized", "succeeded", "refunded", "partially_refunded"].includes(financialState)) {
      return reply({ ok: false, error: "PAYMENT_ALREADY_STARTED" }, 409);
    }

    const checkoutId = String(session.stripe_checkout_session_id ?? "").trim();
    if (checkoutId) {
      const secretKey = (Deno.env.get("STRIPE_SECRET_KEY") ?? "").trim();
      if (!(secretKey.startsWith("sk_test_") || secretKey.startsWith("rk_test_"))) {
        return reply({ ok: false, error: "STRIPE_TEST_KEY_REQUIRED" }, 503);
      }
      const stripe = new Stripe(secretKey, {
        apiVersion: "2025-09-30.clover" as any,
        httpClient: Stripe.createFetchHttpClient(),
      });
      const checkout = await stripe.checkout.sessions.retrieve(checkoutId);
      if (checkout.payment_status === "paid" || checkout.status === "complete") {
        return reply({ ok: false, error: "PAYMENT_ALREADY_STARTED" }, 409);
      }
      if (checkout.status === "open") await stripe.checkout.sessions.expire(checkoutId);
    }

    const now = new Date().toISOString();
    const { data: cancelled, error: cancelError } = await db.from("rental_sessions")
      .update({
        state: "expired",
        cancelled_at: now,
        failure_code: "KIOSK_CANCELLED_BY_CUSTOMER",
        failure_message: "Checkout annulé par le client avant paiement",
        updated_at: now,
      })
      .eq("id", rentalSessionId)
      .is("paid_at", null)
      .in("state", ["created", "checkout_created"])
      .select("id")
      .maybeSingle();
    if (cancelError) throw cancelError;
    if (!cancelled) return reply({ ok: false, error: "CHECKOUT_CANCELLATION_RACE" }, 409);

    await db.from("station_slot_reservations")
      .update({ state: "released", released_at: now, release_reason: "customer_cancelled_checkout", updated_at: now })
      .eq("rental_session_id", rentalSessionId)
      .eq("state", "reserved");

    await db.from("audit_logs").insert({
      action: "kiosk.checkout.cancelled",
      target: rentalSessionId,
      data: {
        station_id: stationId,
        public_session_code: session.public_session_code ?? null,
        stripe_checkout_expired: Boolean(checkoutId),
        correlation_id: correlationId,
      },
    }).then(() => {}, () => {});

    return reply({ ok: true, state: "expired" });
  } catch (error) {
    console.error("cancel-kiosk-checkout", error instanceof Error ? error.message : "UNKNOWN_ERROR");
    return reply({ ok: false, error: "CHECKOUT_CANCEL_FAILED" }, 500);
  }
});
