// cancel-kiosk-checkout — explicit customer cancellation before payment only.
//
// The kiosk may return to the three-choice home only after the real Stripe
// Checkout has been expired. This endpoint is fail-closed once any payment,
// authorization, release or completed-rental evidence exists.
import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  classifyCheckoutIntentForExplicitCancellation,
  stagingAuthorizationReleaseAllowed,
} from "../_shared/checkoutCancellation.ts";

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
    const operatorAuthorizationRelease = body.operatorTestAuthorizationRelease === true
      && body.confirmNoHardwareRelease === true
      && body.confirmTestAuthorizationRelease === true
      && body.recoveryReason === "operator_confirmed_no_hardware_release";
    if (!/^[0-9a-f-]{36}$/i.test(rentalSessionId)) return reply({ ok: false, error: "INVALID_SESSION" }, 400);

    const db = admin();
    const { data: session, error: sessionError } = await db.from("rental_sessions")
      .select("id,station_id,kiosk_device_id,state,paid_at,ejected_at,returned_at,completed_at,stripe_checkout_session_id,public_session_code,deposit_amount_cents,stripe_payment_intent_id,apifox_trade_no,chargenow_order_id,chargenow_status,failure_code")
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

    const normalCancellationState = ["created", "checkout_created"].includes(String(session.state ?? ""));
    const timedOutUnpaidSession = String(session.state ?? "") === "expired"
      && String(session.failure_code ?? "") === "SESSION_EXPIRED";
    // A prior browser cancellation may have already expired the unpaid
    // session before the rail-release write failed. Permit only that precise,
    // idempotent recovery state; all other expired sessions remain closed.
    const customerCancellationRecovery = String(session.state ?? "") === "expired"
      && String(session.failure_code ?? "") === "KIOSK_CANCELLED_BY_CUSTOMER";
    if ((!normalCancellationState
      && !customerCancellationRecovery
      && !(operatorAuthorizationRelease && timedOutUnpaidSession))
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
    if (captured > 0 || refunded > 0
      || ["authorized", "succeeded", "refunded", "partially_refunded"].includes(financialState)) {
      return reply({ ok: false, error: "PAYMENT_ALREADY_STARTED" }, 409);
    }
    if (authorized > 0 && !operatorAuthorizationRelease) {
      return reply({ ok: false, error: "PAYMENT_ALREADY_STARTED" }, 409);
    }

    // An authorization release is a supervised STAGING repair, never a normal
    // customer cancellation. Refuse it as soon as the session has any supplier
    // order/trade reference or any hardware release attempt.
    if (operatorAuthorizationRelease) {
      if (authorized > 0 || session.apifox_trade_no || session.chargenow_order_id) {
        return reply({ ok: false, error: "STAGING_AUTH_RELEASE_NOT_ALLOWED" }, 409);
      }
      const { count, error: attemptError } = await db.from("hardware_release_attempts")
        .select("id", { count: "exact", head: true })
        .eq("rental_session_id", rentalSessionId);
      if (attemptError) throw attemptError;
      if (count !== 0) return reply({ ok: false, error: "STAGING_AUTH_RELEASE_NOT_ALLOWED" }, 409);
    }

    const checkoutId = String(session.stripe_checkout_session_id ?? "").trim();
    let safelyCancelledIntentId: string | null = null;
    let recoveredAuthorizedTestHold = false;
    if (operatorAuthorizationRelease && !checkoutId) {
      return reply({ ok: false, error: "STAGING_AUTH_RELEASE_NOT_ALLOWED" }, 409);
    }
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
      if (!operatorAuthorizationRelease && (checkout.payment_status === "paid" || checkout.status === "complete")) {
        return reply({ ok: false, error: "PAYMENT_ALREADY_STARTED" }, 409);
      }

      // Checkout creates a PaymentIntent before a customer supplies a payment
      // method. Query Stripe before deciding whether that incomplete intent
      // may be cancelled; unknown or asynchronous states stay fail-closed.
      const rawIntent = payment?.stripe_payment_intent_id ?? checkout.payment_intent;
      const intentId = typeof rawIntent === "string" ? rawIntent : rawIntent?.id;
      if (operatorAuthorizationRelease && !(typeof intentId === "string" && intentId)) {
        return reply({ ok: false, error: "STAGING_AUTH_RELEASE_NOT_ALLOWED" }, 409);
      }
      if (typeof intentId === "string" && intentId) {
        const intent = await stripe.paymentIntents.retrieve(intentId);
        if (operatorAuthorizationRelease) {
          const expectedAmountCents = Number(session.deposit_amount_cents ?? 0);
          const alreadyCanceled = intent.status === "canceled"
            && intent.livemode === false
            && Number(intent.amount) === expectedAmountCents
            && Number(intent.amount_received) === 0
            && String(intent.metadata?.rental_session_id ?? "") === rentalSessionId
            && String(intent.metadata?.station_id ?? "") === stationId;
          const allowed = stagingAuthorizationReleaseAllowed({
            requested: body.operatorTestAuthorizationRelease === true,
            confirmedNoHardwareRelease: body.confirmNoHardwareRelease === true,
            confirmedTestAuthorizationRelease: body.confirmTestAuthorizationRelease === true,
            recoveryReason: body.recoveryReason,
            intent,
            expectedRentalSessionId: rentalSessionId,
            expectedStationId: stationId,
            expectedAmountCents,
          });
          if (!allowed && !alreadyCanceled) {
            return reply({ ok: false, error: "STAGING_AUTH_RELEASE_NOT_ALLOWED" }, 409);
          }
          if (intent.status === "requires_capture") {
            const canceledIntent = await stripe.paymentIntents.cancel(intent.id, {
              cancellation_reason: "requested_by_customer",
            });
            if (canceledIntent.status !== "canceled") {
              return reply({ ok: false, error: "PAYMENT_RECONCILIATION_REQUIRED" }, 409);
            }
          }
          safelyCancelledIntentId = intent.id;
          recoveredAuthorizedTestHold = true;
        } else {
          const decision = classifyCheckoutIntentForExplicitCancellation(intent.status);
          if (decision === "payment_confirmed") {
            return reply({ ok: false, error: "PAYMENT_ALREADY_STARTED" }, 409);
          }
          if (decision === "reconciliation_required") {
            return reply({ ok: false, error: "PAYMENT_RECONCILIATION_REQUIRED" }, 409);
          }
          if (decision === "cancelable") {
            const canceledIntent = await stripe.paymentIntents.cancel(intent.id, {
              cancellation_reason: "requested_by_customer",
            });
            if (canceledIntent.status !== "canceled") {
              return reply({ ok: false, error: "PAYMENT_RECONCILIATION_REQUIRED" }, 409);
            }
          }
          safelyCancelledIntentId = intent.id;
        }
      }
      if (checkout.status === "open") await stripe.checkout.sessions.expire(checkoutId);
    }

    // Persist Stripe's confirmed cancellation before ending the rental. If
    // this write fails, leave the rental resumable so the same idempotent
    // path can reconcile it on retry rather than hiding a financial record.
    if (safelyCancelledIntentId) {
      const { error: paymentCancelledError } = await db.from("payments")
        .update({
          status: "canceled",
          amount_authorized_cents: 0,
          amount_captured_cents: 0,
          amount_refunded_cents: 0,
          refunded_at: null,
        })
        .eq("rental_session_id", rentalSessionId)
        .or(`stripe_payment_intent_id.eq.${safelyCancelledIntentId},stripe_payment_intent_id.is.null`);
      if (paymentCancelledError) throw paymentCancelledError;
    }

    const now = new Date().toISOString();
    const { error: reservationError } = await db.from("station_slot_reservations")
      .update({ state: "released", released_at: now, release_reason: "customer_cancelled_checkout", updated_at: now })
      .eq("rental_session_id", rentalSessionId)
      .eq("state", "reserved");
    if (reservationError) throw reservationError;

    // Release the QR claim before expiring the rental in both cancellation
    // paths. The previous implementation did this only for a supervised
    // authorization release, leaving ordinary unpaid QR cancellations
    // permanently ENGAGED even though Stripe had confirmed the cancellation.
    // A release failure remains fail-closed: the session is not expired and
    // the same idempotent request can reconcile it safely.
    const { error: railError } = await db.rpc("release_rental_payment_rail_claim", {
      p_rental_id: rentalSessionId,
      p_expected_rail: "qr_checkout",
      p_reason: recoveredAuthorizedTestHold
        ? "staging_operator_authorization_released_no_ejection"
        : "customer_cancelled_checkout",
    });
    if (railError) throw railError;

    const { data: cancelled, error: cancelError } = await db.from("rental_sessions")
      .update({
        state: "expired",
        cancelled_at: now,
        failure_code: recoveredAuthorizedTestHold
          ? "STAGING_OPERATOR_AUTHORIZATION_RELEASED_NO_EJECTION"
          : "KIOSK_CANCELLED_BY_CUSTOMER",
        failure_message: recoveredAuthorizedTestHold
          ? "Autorisation Stripe TEST annulée après vérification de l'absence d'éjection"
          : "Checkout annulé par le client avant paiement",
        checkout_url: null,
        checkout_url_expires_at: null,
        updated_at: now,
      })
      .eq("id", rentalSessionId)
      .is("paid_at", null)
      .in(
        "state",
        (recoveredAuthorizedTestHold || customerCancellationRecovery)
          ? ["created", "checkout_created", "expired"]
          : ["created", "checkout_created"],
      )
      .select("id")
      .maybeSingle();
    if (cancelError) throw cancelError;
    if (!cancelled) return reply({ ok: false, error: "CHECKOUT_CANCELLATION_RACE" }, 409);

    await db.from("audit_logs").insert({
      action: "kiosk.checkout.cancelled",
      target: rentalSessionId,
      data: {
        station_id: stationId,
        public_session_code: session.public_session_code ?? null,
        stripe_checkout_expired: Boolean(checkoutId),
        stripe_payment_intent_canceled: Boolean(safelyCancelledIntentId),
        staging_operator_authorization_released: recoveredAuthorizedTestHold,
        correlation_id: correlationId,
      },
    }).then(() => {}, () => {});

    return reply({ ok: true, state: "expired" });
  } catch (error) {
    console.error("cancel-kiosk-checkout", error instanceof Error ? error.message : "UNKNOWN_ERROR");
    return reply({ ok: false, error: "CHECKOUT_CANCEL_FAILED" }, 500);
  }
});
