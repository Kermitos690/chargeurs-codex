// eject-after-payment — internal/admin command executed only after a trusted
// Stripe webhook has confirmed the initial authorization or prepayment.
//
// Canonical sequence:
//   authorized → release_requested → released → active
//
// The legacy rental_sessions.state column remains a compatibility projection.
// The Rental Orchestrator journal is the authority for critical transitions.
import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, logApi, auditLog, requireAdmin } from "../_shared/db.ts";
import { ejectByRent, isChargeNowConfigured, orderCreate } from "../_shared/chargenow.ts";
import { appendRentalEvent, OrchestratorError } from "../_shared/rentalOrchestratorRuntime.ts";

const MAX_RETRIES = 3;
type DB = ReturnType<typeof adminClient>;
type Session = Record<string, any>;

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

function safeCode(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value : "";
  return /^[A-Z0-9_:-]{1,120}$/.test(text) ? text : fallback;
}

async function authorizeCaller(req: Request, db: DB): Promise<{ ok: true; actor: string } | { ok: false }> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (token && serviceRole && safeEqual(token, serviceRole)) return { ok: true, actor: "service_role" };
  const adminId = await requireAdmin(req, db);
  return adminId ? { ok: true, actor: adminId } : { ok: false };
}

function extractReleasedBattery(payload: unknown): { batteryId: string | null; slotNum: number | null } {
  const root = payload && typeof payload === "object" ? payload as Record<string, any> : {};
  const data = root.data && typeof root.data === "object" ? root.data as Record<string, any> : root;
  const battery = data.battery && typeof data.battery === "object" ? data.battery as Record<string, any> : data;
  const batteryId = battery.batteryId ?? battery.battery_id ?? battery.sn ?? battery.bid ?? data.batteryId ?? data.sn;
  const slotRaw = battery.slotNum ?? battery.slot ?? battery.slotId ?? data.slotNum ?? data.slot;
  const slotNum = Number(slotRaw);
  return {
    batteryId: typeof batteryId === "string" && batteryId.trim() ? batteryId.trim() : null,
    slotNum: Number.isInteger(slotNum) && slotNum >= 0 ? slotNum : null,
  };
}

async function openIncident(
  db: DB,
  session: Session,
  code: string,
  message: string,
  details: Record<string, unknown> = {},
) {
  await db.from("system_incidents").insert({
    type: "eject_failed_after_payment",
    severity: "high",
    message,
    data: {
      rental_session_id: session.id,
      station_id: session.station_id,
      code,
      ...details,
    },
    resolved: false,
  });
  await auditLog(db, {
    action: "rental.release.incident",
    target: String(session.id),
    data: { code, ...details },
  });
}

async function markFailed(
  db: DB,
  session: Session,
  code: string,
  message: string,
  idempotencyKey: string,
) {
  try {
    await appendRentalEvent(db, {
      rentalId: String(session.id),
      eventType: "rental_failed",
      idempotencyKey,
      paymentIntentId: String(session.stripe_payment_intent_id ?? "") || null,
      stationId: String(session.station_id ?? "") || null,
      failureReason: code,
      metadata: { code },
    });
  } catch (error) {
    if (!(error instanceof OrchestratorError) || error.code !== "INVALID_TRANSITION") throw error;
  }

  const { error } = await db.from("rental_sessions").update({
    state: "needs_support",
    failure_code: code,
    failure_message: message,
  }).eq("id", session.id);
  if (error) throw error;
  await openIncident(db, session, code, message);
}

async function compensateBeforeHardwareRequest(
  db: DB,
  session: Session,
  code: string,
): Promise<{ compensated: boolean; action: string }> {
  const sessionId = String(session.id);
  const paymentIntentId = String(session.stripe_payment_intent_id ?? "");
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  if (!paymentIntentId || !stripeKey) {
    await markFailed(
      db,
      session,
      code,
      "La batterie n'a pas été demandée, mais la compensation financière nécessite une intervention.",
      `release_failed:${sessionId}:${code}`,
    );
    return { compensated: false, action: "manual_review" };
  }

  const stripe = new Stripe(stripeKey, {
    apiVersion: "2024-12-18.acacia",
    httpClient: Stripe.createFetchHttpClient(),
  });
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
  const strategy = String(session.settlement_strategy ?? "");

  let action = "none";
  let refundedCents = Number(session.refunded_amount_cents ?? 0);
  if (strategy === "manual_capture" && intent.status === "requires_capture") {
    await stripe.paymentIntents.cancel(
      paymentIntentId,
      {},
      { idempotencyKey: `release_compensation_cancel:${sessionId}` },
    );
    action = "cancel_authorization";
  } else {
    const capturedCents = Math.max(
      Number(intent.amount_received ?? 0),
      Number(session.captured_amount_cents ?? 0),
    );
    if (capturedCents <= refundedCents) {
      action = "already_refunded";
    } else if (capturedCents > 0) {
      const amount = capturedCents - refundedCents;
      const refund = await stripe.refunds.create(
        { payment_intent: paymentIntentId, amount },
        { idempotencyKey: `release_compensation_refund:${sessionId}:${amount}` },
      );
      refundedCents += amount;
      await db.from("payments").update({
        status: refund.status === "succeeded" ? "refunded" : "partially_refunded",
        refund_id: refund.id,
        refunded_at: new Date().toISOString(),
        amount_refunded_cents: refundedCents,
      }).eq("stripe_payment_intent_id", paymentIntentId);
      action = "refund";
    }
  }

  await appendRentalEvent(db, {
    rentalId: sessionId,
    eventType: "payment_refunded",
    idempotencyKey: `release_compensated:${sessionId}:${code}`,
    paymentIntentId,
    stationId: String(session.station_id ?? "") || null,
    metadata: { reason: code, compensationAction: action, refundedCents },
  });
  await appendRentalEvent(db, {
    rentalId: sessionId,
    eventType: "rental_completed",
    idempotencyKey: `release_compensation_completed:${sessionId}:${code}`,
    paymentIntentId,
    stationId: String(session.station_id ?? "") || null,
    metadata: { reason: code, compensationAction: action },
  });

  await db.from("rental_sessions").update({
    state: "refunded",
    settlement_status: "settled",
    settlement_error: code,
    refunded_amount_cents: refundedCents,
    closed_at: new Date().toISOString(),
  }).eq("id", sessionId);

  await auditLog(db, {
    action: "rental.release.compensated",
    target: sessionId,
    data: { code, action, refunded_cents: refundedCents },
  });
  return { compensated: true, action };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return response({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const db = adminClient();
  const caller = await authorizeCaller(req, db);
  if (!caller.ok) return response({ ok: false, error: "FORBIDDEN" }, 403);

  let rentalSessionId = "";
  try {
    const body = await req.json().catch(() => ({}));
    rentalSessionId = typeof body.rentalSessionId === "string" ? body.rentalSessionId : "";
    if (!/^[0-9a-f-]{36}$/i.test(rentalSessionId)) {
      return response({ ok: false, error: "INVALID_RENTAL_ID" }, 400);
    }

    const { data: session, error: sessionError } = await db.from("rental_sessions")
      .select("*").eq("id", rentalSessionId).maybeSingle();
    if (sessionError) throw sessionError;
    if (!session) return response({ ok: false, error: "SESSION_NOT_FOUND" }, 404);

    if (["ejected", "battery_taken", "active_rental", "battery_returned", "closed", "completed"].includes(session.state)) {
      return response({ ok: true, alreadyDone: true, batteryId: session.battery_id ?? null });
    }
    if (["refund_pending", "refunded"].includes(session.state)) {
      return response({ ok: true, compensated: true, state: session.state });
    }
    if (!['authorized', 'prepaid'].includes(String(session.settlement_status))) {
      return response({ ok: false, error: "PAYMENT_NOT_CONFIRMED" }, 409);
    }

    await appendRentalEvent(db, {
      rentalId: rentalSessionId,
      eventType: "release_requested",
      idempotencyKey: `release_requested:${rentalSessionId}`,
      paymentIntentId: String(session.stripe_payment_intent_id ?? "") || null,
      stationId: String(session.station_id ?? "") || null,
      metadata: { actor: caller.actor },
    });

    if (!isChargeNowConfigured()) {
      const compensation = await compensateBeforeHardwareRequest(db, session, "CHARGENOW_NOT_CONFIGURED");
      return response({ ok: false, error: "CHARGENOW_NOT_CONFIGURED", compensation }, 503);
    }

    const retry = Number(session.retry_count ?? 0);
    if (retry >= MAX_RETRIES) {
      const compensation = await compensateBeforeHardwareRequest(db, session, "MAX_RETRIES");
      return response({ ok: false, error: "MAX_RETRIES", compensation }, 409);
    }

    // Legacy row lock prevents a second worker from issuing the physical call.
    const { data: locked, error: lockError } = await db.from("rental_sessions")
      .update({ state: "ejecting", retry_count: retry + 1 })
      .eq("id", session.id)
      .in("state", ["payment_succeeded", "chargenow_failed", "eject_failed"])
      .select("id");
    if (lockError) throw lockError;
    if (!locked || locked.length === 0) return response({ ok: true, alreadyInProgress: true }, 202);

    const cabinetId = String(session.cabinet_id || session.station_id || "");
    if (!cabinetId) {
      const compensation = await compensateBeforeHardwareRequest(db, session, "CABINET_ID_MISSING");
      return response({ ok: false, error: "CABINET_ID_MISSING", compensation }, 409);
    }

    let tradeNo: string | null = session.apifox_trade_no ?? null;
    if (!tradeNo) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      if (!supabaseUrl) throw new Error("SUPABASE_INTERNAL_CONFIG_MISSING");
      const callbackURL = `${supabaseUrl}/functions/v1/chargenow-rent-callback`;
      const order = await orderCreate({ deviceId: cabinetId, callbackURL });
      const orderData = order.data as { data?: { tradeNo?: string; orderId?: string }; tradeNo?: string } | null;
      tradeNo = orderData?.data?.tradeNo ?? orderData?.tradeNo ?? null;
      const orderId = orderData?.data?.orderId ?? null;

      await logApi(db, {
        service: "chargenow",
        endpoint: "/rent/order/create",
        method: "POST",
        status_code: order.status,
        request: { cabinetId },
        response: { ok: order.ok, tradeNo, orderId },
        error: order.ok ? null : safeCode(order.error, "CHARGENOW_ORDER_FAILED"),
      });

      await db.from("apifox_orders").upsert({
        rental_session_id: session.id,
        trade_no: tradeNo,
        request: { cabinetId },
        response: { ok: order.ok, tradeNo, orderId },
        status: order.ok ? "created" : "error",
      }, { onConflict: "rental_session_id" });

      if (!order.ok || !tradeNo) {
        const code = safeCode(order.error, "CHARGENOW_ORDER_FAILED");
        const compensation = await compensateBeforeHardwareRequest(db, session, code);
        return response({ ok: false, error: code, compensation }, 502);
      }

      const { error: orderUpdateError } = await db.from("rental_sessions").update({
        apifox_trade_no: tradeNo,
        chargenow_order_id: orderId,
        chargenow_status: "created",
      }).eq("id", session.id);
      if (orderUpdateError) throw orderUpdateError;
    }

    const requestedSlotNum = Number(session.selected_slot_num ?? 0);
    const ejection = await ejectByRent(cabinetId, requestedSlotNum, tradeNo ?? undefined);
    const released = extractReleasedBattery(ejection.data);
    const selectedSlotNum = released.slotNum ?? requestedSlotNum;

    await logApi(db, {
      service: "chargenow",
      endpoint: "/cabinet/ejectByRent",
      method: "POST",
      status_code: ejection.status,
      request: { cabinetId, slotNum: requestedSlotNum, tradeNo },
      response: {
        ok: ejection.ok,
        batteryId: released.batteryId,
        slotNum: selectedSlotNum,
      },
      error: ejection.ok ? null : safeCode(ejection.error, "EJECTION_UNCONFIRMED"),
    });

    if (!ejection.ok) {
      // The physical command was sent but the release was not confirmed. Do not
      // refund or retry automatically: a lost provider response could otherwise
      // produce a free battery or a double ejection. Reconciliation is required.
      const code = safeCode(ejection.error, "EJECTION_UNCONFIRMED");
      await db.from("rental_sessions").update({
        state: "needs_support",
        chargenow_status: "release_unconfirmed",
        failure_code: code,
        failure_message: "La commande a été envoyée mais la sortie de batterie n'est pas confirmée.",
      }).eq("id", session.id);
      await openIncident(
        db,
        session,
        code,
        "Résultat d'éjection incertain — réconciliation ChargeNow obligatoire avant toute compensation.",
        { cabinetId, tradeNo, requestedSlotNum },
      );
      return response({ ok: false, error: "EJECTION_RECONCILIATION_REQUIRED" }, 202);
    }

    if (!released.batteryId) {
      await db.from("rental_sessions").update({
        state: "needs_support",
        chargenow_status: "released_battery_unknown",
        failure_code: "BATTERY_ID_MISSING",
        failure_message: "ChargeNow confirme une sortie sans identifiant de batterie exploitable.",
      }).eq("id", session.id);
      await openIncident(
        db,
        session,
        "BATTERY_ID_MISSING",
        "La batterie sortie ne peut pas être corrélée de manière certaine.",
        { cabinetId, tradeNo, slotNum: selectedSlotNum },
      );
      return response({ ok: false, error: "BATTERY_CORRELATION_REQUIRED" }, 202);
    }

    const releasedAt = new Date().toISOString();
    await appendRentalEvent(db, {
      rentalId: rentalSessionId,
      eventType: "battery_released",
      idempotencyKey: `battery_released:${tradeNo}:${released.batteryId}`,
      paymentIntentId: String(session.stripe_payment_intent_id ?? "") || null,
      stationId: String(session.station_id ?? "") || null,
      batteryId: released.batteryId,
      occurredAt: releasedAt,
      metadata: { cabinetId, slotNum: selectedSlotNum, tradeNo },
    });
    await appendRentalEvent(db, {
      rentalId: rentalSessionId,
      eventType: "rental_activated",
      idempotencyKey: `rental_activated:${tradeNo}:${released.batteryId}`,
      paymentIntentId: String(session.stripe_payment_intent_id ?? "") || null,
      stationId: String(session.station_id ?? "") || null,
      batteryId: released.batteryId,
      occurredAt: releasedAt,
      metadata: { cabinetId, slotNum: selectedSlotNum, tradeNo },
    });

    const { error: releaseUpdateError } = await db.from("rental_sessions").update({
      state: "ejected",
      ejected_at: releasedAt,
      chargenow_status: "ejected",
      started_at: releasedAt,
      selected_slot_num: selectedSlotNum,
      battery_id: released.batteryId,
    }).eq("id", session.id);
    if (releaseUpdateError) throw releaseUpdateError;

    await auditLog(db, {
      actor: caller.actor,
      action: "rental.released",
      target: session.id,
      data: { cabinetId, slotNum: selectedSlotNum, tradeNo, battery_id: released.batteryId },
    });
    return response({ ok: true, slotNum: selectedSlotNum, batteryId: released.batteryId });
  } catch (error) {
    const code = error instanceof OrchestratorError ? error.code : safeCode(
      error instanceof Error ? error.message : "",
      "EJECTION_INTERNAL_ERROR",
    );
    console.error("eject-after-payment failed", code, rentalSessionId || "unknown");
    return response({ ok: false, error: code }, error instanceof OrchestratorError ? 409 : 500);
  }
});
