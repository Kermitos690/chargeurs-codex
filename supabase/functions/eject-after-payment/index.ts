// eject-after-payment — runs ONLY after a confirmed Stripe payment (called by
// stripe-webhook) or by an authenticated admin tool. State machine:
//   payment_succeeded → ejecting → ejected
//   failure → chargenow_failed / eject_failed → refund_pending → refunded
import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, logApi, auditLog, requireAdmin } from "../_shared/db.ts";
import { ejectByRent, isChargeNowConfigured, orderCreate } from "../_shared/chargenow.ts";
import { extractEjectedBattery } from "../_shared/returnCorrelation.ts";

const MAX_RETRIES = 3;
type DB = ReturnType<typeof adminClient>;

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

async function authorizeCaller(req: Request, db: DB): Promise<{ ok: true; actor: string } | { ok: false }> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (token && serviceRole && safeEqual(token, serviceRole)) return { ok: true, actor: "service_role" };
  const adminId = await requireAdmin(req, db);
  return adminId ? { ok: true, actor: adminId } : { ok: false };
}

async function refundOnFailure(db: DB, session: Record<string, unknown>, code: string) {
  const sessionId = session.id as string;
  const { data: existing } = await db.from("refunds")
    .select("id,status").eq("rental_session_id", sessionId)
    .in("status", ["pending", "succeeded", "processing"]).maybeSingle();
  if (existing) {
    await auditLog(db, { action: "refund.skipped.duplicate", target: sessionId, data: { code } });
    return;
  }

  await db.from("system_incidents").insert({
    type: "eject_failed_after_payment", severity: "high",
    message: `Échec post-paiement (${code}) — remboursement automatique déclenché.`,
    data: { rental_session_id: sessionId, code, station_id: session.station_id },
  });

  const paymentIntentId = session.stripe_payment_intent_id as string | null;
  const capturedCents = Math.round(Number(session.amount_paid ?? session.amount_expected ?? 0) * 100);
  if (!paymentIntentId || capturedCents <= 0) {
    await db.from("rental_sessions").update({ state: "needs_support" }).eq("id", sessionId);
    await auditLog(db, { action: "refund.not_applicable", target: sessionId, data: { code, capturedCents } });
    return;
  }

  await db.from("rental_sessions").update({ state: "refund_pending" }).eq("id", sessionId);
  const { data: refundRow } = await db.from("refunds").insert({
    rental_session_id: sessionId, amount: capturedCents / 100,
    currency: session.currency ?? "CHF", status: "pending",
    reason: code, created_by: "system",
  }).select().single();

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  if (!stripeKey) {
    await auditLog(db, { action: "refund.error", target: sessionId, data: { code: "STRIPE_NOT_CONFIGURED" } });
    return;
  }
  const stripe = new Stripe(stripeKey, { apiVersion: "2024-12-18.acacia", httpClient: Stripe.createFetchHttpClient() });
  try {
    const refund = await stripe.refunds.create(
      { payment_intent: paymentIntentId, reason: "requested_by_customer" },
      { idempotencyKey: `refund_${sessionId}` },
    );
    await db.from("refunds").update({
      status: refund.status === "succeeded" ? "succeeded" : "processing",
      stripe_refund_id: refund.id,
    }).eq("id", refundRow?.id);
    await db.from("payments").update({
      status: "refunded", refund_id: refund.id, refunded_at: new Date().toISOString(),
    }).eq("stripe_payment_intent_id", paymentIntentId);
    await db.from("rental_sessions").update({
      state: refund.status === "succeeded" ? "refunded" : "refund_pending",
    }).eq("id", sessionId);
    await auditLog(db, {
      action: "refund.issued", target: sessionId,
      data: { code, stripe_refund_id: refund.id, amount_cents: capturedCents, status: refund.status },
    });
  } catch (error) {
    await db.from("refunds").update({ status: "error" }).eq("id", refundRow?.id);
    await auditLog(db, { action: "refund.error", target: sessionId, data: { code, error: String(error) } });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const db = adminClient();
  const response = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const caller = await authorizeCaller(req, db);
  if (!caller.ok) return response({ ok: false, error: "FORBIDDEN" }, 403);

  try {
    const { rentalSessionId } = await req.json();
    if (!rentalSessionId || !/^[0-9a-f-]{36}$/i.test(String(rentalSessionId))) {
      return response({ ok: false, error: "INVALID_RENTAL_ID" }, 400);
    }

    const { data: session } = await db.from("rental_sessions")
      .select("*").eq("id", rentalSessionId).maybeSingle();
    if (!session) return response({ ok: false, error: "SESSION_NOT_FOUND" }, 404);

    if (["ejected", "battery_taken", "active_rental", "battery_returned", "closed", "completed"].includes(session.state)) {
      return response({ ok: true, alreadyDone: true, batteryId: session.battery_id ?? null });
    }
    if (["refund_pending", "refunded"].includes(session.state)) {
      return response({ ok: true, refunded: true, state: session.state });
    }
    if (!["payment_succeeded", "ejecting", "chargenow_failed", "eject_failed"].includes(session.state)) {
      return response({ ok: false, error: "NOT_PAID", state: session.state }, 409);
    }

    if (!isChargeNowConfigured()) {
      await db.from("rental_sessions").update({
        state: "chargenow_failed", failure_code: "CHARGENOW_NOT_CONFIGURED",
        failure_message: "API ChargeNow non configurée — éjection impossible.",
      }).eq("id", session.id);
      await refundOnFailure(db, session, "CHARGENOW_NOT_CONFIGURED");
      return response({ ok: false, error: "CHARGENOW_NOT_CONFIGURED" });
    }

    const retry = Number(session.retry_count ?? 0);
    if (retry >= MAX_RETRIES) {
      await db.from("rental_sessions").update({
        state: "eject_failed", failure_code: "MAX_RETRIES",
        failure_message: "Nombre maximal de tentatives atteint.",
      }).eq("id", session.id);
      await refundOnFailure(db, session, "MAX_RETRIES");
      return response({ ok: false, error: "MAX_RETRIES" });
    }

    const { data: locked } = await db.from("rental_sessions")
      .update({ state: "ejecting", retry_count: retry + 1 })
      .eq("id", session.id)
      .in("state", ["payment_succeeded", "chargenow_failed", "eject_failed"])
      .select();
    if (!locked || locked.length === 0) return response({ ok: true, alreadyInProgress: true });

    const cabinetId = session.cabinet_id || session.station_id;
    let tradeNo: string | null = session.apifox_trade_no ?? null;
    if (!tradeNo) {
      const callbackURL = `${Deno.env.get("SUPABASE_URL")}/functions/v1/chargenow-rent-callback`;
      const order = await orderCreate({ deviceId: cabinetId, callbackURL });
      await logApi(db, {
        service: "chargenow", endpoint: "/rent/order/create", method: "POST",
        status_code: order.status, request: { cabinetId }, response: order.data, error: order.error,
      });
      const data = order.data as { data?: { tradeNo?: string; orderId?: string }; tradeNo?: string } | null;
      tradeNo = data?.data?.tradeNo ?? data?.tradeNo ?? null;
      const orderId = data?.data?.orderId ?? null;

      await db.from("apifox_orders").upsert({
        rental_session_id: session.id, trade_no: tradeNo,
        request: { cabinetId }, response: order.data, status: order.ok ? "created" : "error",
      }, { onConflict: "rental_session_id" });

      if (!order.ok || !tradeNo) {
        await db.from("rental_sessions").update({
          state: "chargenow_failed", failure_code: order.error ?? "ORDER_FAILED",
          failure_message: "Paiement reçu mais commande ChargeNow impossible — remboursement en cours.",
        }).eq("id", session.id);
        await refundOnFailure(db, session, order.error ?? "ORDER_FAILED");
        return response({ ok: false, error: order.error ?? "ORDER_FAILED" });
      }
      await db.from("rental_sessions").update({
        apifox_trade_no: tradeNo, chargenow_order_id: orderId, chargenow_status: "created",
      }).eq("id", session.id);
    }

    const requestedSlotNum = session.selected_slot_num ?? 0;
    const ejection = await ejectByRent(cabinetId, requestedSlotNum, tradeNo ?? undefined);
    await logApi(db, {
      service: "chargenow", endpoint: "/cabinet/ejectByRent", method: "POST",
      status_code: ejection.status, request: { cabinetId, slotNum: requestedSlotNum }, response: ejection.data, error: ejection.error,
    });

    if (ejection.ok) {
      const released = extractEjectedBattery(ejection.data);
      const selectedSlotNum = released.slotNum ?? requestedSlotNum;
      await db.from("rental_sessions").update({
        state: "ejected", ejected_at: new Date().toISOString(),
        chargenow_status: "ejected", started_at: new Date().toISOString(),
        selected_slot_num: selectedSlotNum,
        battery_id: released.batteryId ?? session.battery_id ?? null,
      }).eq("id", session.id);
      await db.from("rental_orchestrator_snapshots").update({
        state: "released",
        station_id: String(session.station_id),
        battery_id: released.batteryId ?? session.battery_id ?? null,
        payment_intent_id: session.stripe_payment_intent_id ?? null,
      }).eq("rental_id", session.id).then(() => {}, () => {});
      await auditLog(db, {
        actor: caller.actor,
        action: "rental.released", target: session.id,
        data: { cabinetId, slotNum: selectedSlotNum, tradeNo, battery_id: released.batteryId ?? null },
      });
      return response({ ok: true, slotNum: selectedSlotNum, batteryId: released.batteryId });
    }

    await db.from("rental_sessions").update({
      state: "eject_failed", failure_code: ejection.error,
      failure_message: "Éjection échouée après paiement — remboursement automatique en cours.",
    }).eq("id", session.id);
    const { data: fresh } = await db.from("rental_sessions").select("*").eq("id", session.id).maybeSingle();
    await refundOnFailure(db, fresh ?? session, ejection.error ?? "EJECT_FAILED");
    return response({ ok: false, error: ejection.error });
  } catch (error) {
    return response({ ok: false, error: "EJECTION_INTERNAL_ERROR", detail: String(error) }, 500);
  }
});
