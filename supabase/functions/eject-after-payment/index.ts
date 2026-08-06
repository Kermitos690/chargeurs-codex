// Internal battery release after a trusted Stripe authorization/prepayment.
// Canonical lifecycle: authorized → release_requested → released → active.
import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import { validateStripeTestRuntime } from "../_shared/stripeRuntimeConfig.ts";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, logApi, auditLog, requireAdmin } from "../_shared/db.ts";
import {
  areHardwareEjectionsEnabled,
  chargeNowMode,
  ejectByRent,
  ejectByRentWithOneTimeRentalPermit,
  isChargeNowConfigured,
  oneTimeRentalEjectionPermit,
  orderCreate,
} from "../_shared/chargenow.ts";
import { buildChargeNowCallbackUrl } from "../_shared/chargenowCallbackAuth.ts";
import { appendRentalEvent, OrchestratorError } from "../_shared/rentalOrchestratorRuntime.ts";
import { resolveRentSlot } from "../_shared/chargenowSafety.ts";

const MAX_RETRIES = 3;
type DB = ReturnType<typeof adminClient>;
type Session = Record<string, any>;

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}

function safeCode(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value : "";
  return /^[A-Z0-9_:-]{1,120}$/.test(text) ? text : fallback;
}

async function authorizeCaller(
  req: Request,
  db: DB,
): Promise<{ ok: true; actor: string } | { ok: false }> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (token && serviceRole && safeEqual(token, serviceRole)) {
    return { ok: true, actor: "service_role" };
  }
  const adminId = await requireAdmin(req, db);
  return adminId ? { ok: true, actor: adminId } : { ok: false };
}

function extractReleasedBattery(payload: unknown): { batteryId: string | null; slotNum: number | null } {
  const root = payload && typeof payload === "object" ? payload as Record<string, any> : {};
  const data = root.data && typeof root.data === "object" ? root.data as Record<string, any> : root;
  const battery = data.battery && typeof data.battery === "object"
    ? data.battery as Record<string, any>
    : data;
  const batteryId = battery.batteryId ?? battery.battery_id ?? battery.sn ?? battery.bid ??
    data.batteryId ?? data.sn;
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
  const { error } = await db.from("system_incidents").insert({
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
  if (error) throw error;
  await auditLog(db, {
    action: "rental.release.incident",
    target: String(session.id),
    data: { code, ...details },
  });
}

async function markSupportRequired(
  db: DB,
  session: Session,
  code: string,
  message: string,
  details: Record<string, unknown> = {},
) {
  const { error } = await db.from("rental_sessions").update({
    state: "needs_support",
    failure_code: code,
    failure_message: message,
  }).eq("id", session.id);
  if (error) throw error;
  await openIncident(db, session, code, message, { retryable: true, ...details });
}

type ReleaseBlockResult = {
  state: "needs_support";
  terminal: true;
  idempotent: boolean;
  mode: "simulation" | "disabled";
};

// A disabled hardware gate is an intentional staging terminal, not a transient
// provider error. Persist it before returning so the kiosk leaves the
// "Préparation" screen. No cancellation/refund is attempted here: the payment
// state remains available for an operator to reconcile explicitly.
async function markHardwareReleaseBlocked(
  db: DB,
  session: Session,
): Promise<ReleaseBlockResult> {
  const code = "HARDWARE_EJECTION_DISABLED";
  const mode = (Deno.env.get("CHARGENOW_MODE") ?? "test").trim().toLowerCase() === "test"
    ? "simulation"
    : "disabled";
  const message = mode === "simulation"
    ? "Paiement confirmé en staging; la sortie matérielle est désactivée et requiert une validation opérateur."
    : "Paiement confirmé; la sortie matérielle est désactivée et requiert une validation opérateur.";

  const { data: transitioned, error } = await db.from("rental_sessions").update({
    state: "needs_support",
    chargenow_status: mode === "simulation" ? "simulation_ejection_blocked" : "hardware_ejection_disabled",
    failure_code: code,
    failure_message: message,
  }).eq("id", session.id)
    .in("state", ["payment_succeeded", "chargenow_failed", "eject_failed"])
    .select("id");
  if (error) throw error;

  const changed = Boolean(transitioned && transitioned.length > 0);
  if (changed) {
    await openIncident(db, session, code, message, {
      hardware_command_issued: false,
      mode,
      compensation: "manual_review_required",
      automatic_refund: false,
    });
  } else {
    const { data: latest, error: latestError } = await db.from("rental_sessions")
      .select("state, failure_code").eq("id", session.id).maybeSingle();
    if (latestError) throw latestError;
    if (latest?.state !== "needs_support" || latest?.failure_code !== code) {
      await auditLog(db, {
        action: "rental.release.block_refused",
        target: String(session.id),
        data: { code: "SESSION_NOT_RELEASABLE", current_state: latest?.state ?? session.state },
      });
      throw new OrchestratorError("SESSION_NOT_RELEASABLE");
    }
  }

  // Close the canonical orchestrator as well as the legacy UI projection.
  // This event is idempotent, so a webhook retry repairs a partial database
  // write without issuing hardware or financial side effects.
  await appendRentalEvent(db, {
    rentalId: String(session.id),
    eventType: "rental_failed",
    idempotencyKey: `release_blocked:${session.id}:${code}`,
    paymentIntentId: String(session.stripe_payment_intent_id ?? "") || null,
    stationId: String(session.station_id ?? "") || null,
    failureReason: code,
    metadata: { mode, hardwareCommandIssued: false, automaticRefund: false },
  });

  await auditLog(db, {
    action: changed ? "rental.release.blocked" : "rental.release.blocked_replay",
    target: String(session.id),
    data: { code, mode, hardware_command_issued: false, automatic_refund: false },
  });
  return { state: "needs_support", terminal: true, idempotent: !changed, mode };
}

// Safe only before the physical ejection command has been sent.
async function compensateBeforeHardwareRequest(
  db: DB,
  session: Session,
  code: string,
): Promise<{ compensated: boolean; action: string }> {
  const sessionId = String(session.id);
  const paymentIntentId = String(session.stripe_payment_intent_id ?? "");
  const stripeRuntime = validateStripeTestRuntime();
  if (!paymentIntentId || !stripeRuntime.ok) {
    await markSupportRequired(
      db,
      session,
      code,
      "La batterie n'a pas été demandée, mais la compensation financière nécessite une intervention.",
      { phase: "before_hardware_command" },
    );
    return { compensated: false, action: "manual_review" };
  }

  const stripe = new Stripe(stripeRuntime.secretKey, {
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
      const { error: paymentError } = await db.from("payments").update({
        status: refund.status === "succeeded" ? "refunded" : "partially_refunded",
        refund_id: refund.id,
        refunded_at: new Date().toISOString(),
        amount_refunded_cents: refundedCents,
      }).eq("stripe_payment_intent_id", paymentIntentId);
      if (paymentError) throw paymentError;
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

  const { error: sessionError } = await db.from("rental_sessions").update({
    state: "refunded",
    settlement_status: "settled",
    settlement_error: code,
    refunded_amount_cents: refundedCents,
    closed_at: new Date().toISOString(),
  }).eq("id", sessionId);
  if (sessionError) throw sessionError;

  await auditLog(db, {
    action: "rental.release.compensated",
    target: sessionId,
    data: { code, action, refunded_cents: refundedCents },
  });
  return { compensated: true, action };
}

async function recoverUnexpectedFailure(
  db: DB,
  session: Session | null,
  code: string,
  hardwareCommandIssued: boolean,
) {
  if (!session) return;

  if (hardwareCommandIssued) {
    const { error } = await db.from("rental_sessions").update({
      state: "needs_support",
      chargenow_status: "release_unconfirmed",
      failure_code: code,
      failure_message: "Une erreur est survenue après l'envoi de la commande d'éjection. Une réconciliation est obligatoire.",
    }).eq("id", session.id);
    if (error) throw error;
    await openIncident(
      db,
      session,
      "EJECTION_RECONCILIATION_REQUIRED",
      "Une erreur est survenue après l'envoi de la commande matérielle. Aucun retry ou remboursement automatique n'est autorisé.",
      { underlying_code: code, hardware_command_issued: true },
    );
    return;
  }

  // The physical command was not sent. Release the legacy lock so an operator
  // can safely retry with the same orchestrator event and ChargeNow order.
  const { error } = await db.from("rental_sessions").update({
    state: "eject_failed",
    chargenow_status: "pre_command_failed",
    failure_code: code,
    failure_message: "La préparation de l'éjection a échoué avant l'envoi de la commande matérielle.",
  }).eq("id", session.id).eq("state", "ejecting");
  if (error) throw error;
  await auditLog(db, {
    action: "rental.release.retryable_pre_command_failure",
    target: String(session.id),
    data: { code, hardware_command_issued: false },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const db = adminClient();
  const caller = await authorizeCaller(req, db);
  if (!caller.ok) return reply({ ok: false, error: "FORBIDDEN" }, 403);

  let rentalSessionId = "";
  let session: Session | null = null;
  let hardwareCommandIssued = false;

  try {
    const body = await req.json().catch(() => ({}));
    rentalSessionId = typeof body.rentalSessionId === "string" ? body.rentalSessionId : "";
    if (!/^[0-9a-f-]{36}$/i.test(rentalSessionId)) {
      return reply({ ok: false, error: "INVALID_RENTAL_ID" }, 400);
    }

    const { data, error: sessionError } = await db.from("rental_sessions")
      .select("*").eq("id", rentalSessionId).maybeSingle();
    if (sessionError) throw sessionError;
    if (!data) return reply({ ok: false, error: "SESSION_NOT_FOUND" }, 404);
    session = data as Session;

    const permit = oneTimeRentalEjectionPermit();
    const cabinetId = String(session.cabinet_id || session.station_id || "");
    const requestedSlotNum = Number(session.selected_slot_num);
    // This is the sole exception to the hardware kill switch. It requires a
    // short-lived server-only permit that matches the exact paid rental,
    // cabinet and slot, and can never operate outside ChargeNow test mode.
    const oneTimeTestResume = Boolean(
      session.state === "needs_support" &&
      session.failure_code === "HARDWARE_EJECTION_DISABLED" &&
      chargeNowMode() === "test" &&
      permit &&
      permit.rentalSessionId === session.id &&
      permit.stationId === cabinetId &&
      permit.slotNum === requestedSlotNum,
    );

    if (["ejected", "battery_taken", "active_rental", "battery_returned", "closed", "completed"].includes(session.state)) {
      return reply({ ok: true, alreadyDone: true, batteryId: session.battery_id ?? null });
    }
    if (["refund_pending", "refunded"].includes(session.state)) {
      return reply({ ok: true, compensated: true, state: session.state });
    }
    if (session.state === "needs_support" && session.failure_code === "HARDWARE_EJECTION_DISABLED" && !oneTimeTestResume) {
      const blocked = await markHardwareReleaseBlocked(db, session);
      return reply({ ok: false, error: "HARDWARE_EJECTION_DISABLED", ...blocked });
    }
    if (session.state === "ejecting") {
      return reply({ ok: true, alreadyInProgress: true, state: "ejecting" }, 202);
    }
    if (!["authorized", "prepaid"].includes(String(session.settlement_status))) {
      return reply({ ok: false, error: "PAYMENT_NOT_CONFIRMED" }, 409);
    }

    await appendRentalEvent(db, {
      rentalId: rentalSessionId,
      eventType: "release_requested",
      idempotencyKey: `release_requested:${rentalSessionId}`,
      paymentIntentId: String(session.stripe_payment_intent_id ?? "") || null,
      stationId: String(session.station_id ?? "") || null,
      metadata: { actor: caller.actor },
    });

    if (!areHardwareEjectionsEnabled() && !oneTimeTestResume) {
      const blocked = await markHardwareReleaseBlocked(db, session);
      // HTTP 200 acknowledges the internal webhook request. The business
      // result remains explicit and terminal, preventing a retry loop.
      return reply({ ok: false, error: "HARDWARE_EJECTION_DISABLED", ...blocked });
    }
    if (!isChargeNowConfigured()) {
      const compensation = await compensateBeforeHardwareRequest(db, session, "CHARGENOW_NOT_CONFIGURED");
      return reply({ ok: false, error: "CHARGENOW_NOT_CONFIGURED", compensation }, 503);
    }

    const slotDecision = resolveRentSlot(
      session.selected_slot_num,
      Deno.env.get("CHARGENOW_RENT_SLOT_ZERO_MODE"),
    );
    if (!slotDecision.ok) {
      const compensation = await compensateBeforeHardwareRequest(db, session, slotDecision.error);
      return reply({ ok: false, error: slotDecision.error, compensation }, 409);
    }
    const resolvedSlotNum = slotDecision.slotNum;

    const retry = Number(session.retry_count ?? 0);
    if (retry >= MAX_RETRIES) {
      const compensation = await compensateBeforeHardwareRequest(db, session, "MAX_RETRIES");
      return reply({ ok: false, error: "MAX_RETRIES", compensation }, 409);
    }

    const { data: locked, error: lockError } = await db.from("rental_sessions")
      .update({ state: "ejecting", retry_count: retry + 1 })
      .eq("id", session.id)
      .in("state", oneTimeTestResume
        ? ["payment_succeeded", "chargenow_failed", "eject_failed", "needs_support"]
        : ["payment_succeeded", "chargenow_failed", "eject_failed"])
      .select("id");
    if (lockError) throw lockError;
    if (!locked || locked.length === 0) return reply({ ok: true, alreadyInProgress: true }, 202);

    if (!cabinetId) {
      const compensation = await compensateBeforeHardwareRequest(db, session, "CABINET_ID_MISSING");
      return reply({ ok: false, error: "CABINET_ID_MISSING", compensation }, 409);
    }

    let tradeNo: string | null = session.apifox_trade_no ?? null;
    if (!tradeNo) {
      const callbackURL = await buildChargeNowCallbackUrl(
        Deno.env.get("SUPABASE_URL") ?? "",
        rentalSessionId,
      );
      const order = await orderCreate({ deviceId: cabinetId, callbackURL });
      const orderData = order.data as {
        data?: { tradeNo?: string; orderId?: string };
        tradeNo?: string;
      } | null;
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
      const { error: orderRecordError } = await db.from("apifox_orders").upsert({
        rental_session_id: session.id,
        trade_no: tradeNo,
        request: { cabinetId },
        response: { ok: order.ok, tradeNo, orderId },
        status: order.ok ? "created" : "error",
      }, { onConflict: "rental_session_id" });
      if (orderRecordError) throw orderRecordError;

      if (!order.ok || !tradeNo) {
        const code = safeCode(order.error, "CHARGENOW_ORDER_FAILED");
        const compensation = await compensateBeforeHardwareRequest(db, session, code);
        return reply({ ok: false, error: code, compensation }, 502);
      }
      const { error: orderUpdateError } = await db.from("rental_sessions").update({
        apifox_trade_no: tradeNo,
        chargenow_order_id: orderId,
        chargenow_status: "created",
      }).eq("id", session.id);
      if (orderUpdateError) throw orderUpdateError;
      session.apifox_trade_no = tradeNo;
      session.chargenow_order_id = orderId;
    }

    // From this line onward, any thrown error is physically ambiguous: the HTTP
    // request may have reached the supplier even when no response is available.
    hardwareCommandIssued = true;
    const ejection = oneTimeTestResume
      ? await ejectByRentWithOneTimeRentalPermit(cabinetId, resolvedSlotNum, tradeNo ?? "", rentalSessionId)
      : await ejectByRent(cabinetId, resolvedSlotNum, tradeNo ?? undefined);
    const released = extractReleasedBattery(ejection.data);
    const selectedSlotNum = released.slotNum ?? resolvedSlotNum;

    await logApi(db, {
      service: "chargenow",
      endpoint: "/cabinet/ejectByRent",
      method: "POST",
      status_code: ejection.status,
      request: { cabinetId, slotNum: resolvedSlotNum, tradeNo, one_time_test_resume: oneTimeTestResume },
      response: { ok: ejection.ok, batteryId: released.batteryId, slotNum: selectedSlotNum },
      error: ejection.ok ? null : safeCode(ejection.error, "EJECTION_UNCONFIRMED"),
    });

    if (!ejection.ok) {
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
        { cabinetId, tradeNo, requestedSlotNum: resolvedSlotNum },
      );
      return reply({ ok: false, error: "EJECTION_RECONCILIATION_REQUIRED" }, 202);
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
      return reply({ ok: false, error: "BATTERY_CORRELATION_REQUIRED" }, 202);
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
      failure_code: null,
      failure_message: null,
    }).eq("id", session.id);
    if (releaseUpdateError) throw releaseUpdateError;

    await auditLog(db, {
      actor: caller.actor,
      action: "rental.released",
      target: session.id,
      data: { cabinetId, slotNum: selectedSlotNum, tradeNo, battery_id: released.batteryId },
    });
    return reply({ ok: true, slotNum: selectedSlotNum, batteryId: released.batteryId });
  } catch (error) {
    const code = error instanceof OrchestratorError
      ? error.code
      : safeCode(error instanceof Error ? error.message : "", "EJECTION_INTERNAL_ERROR");
    try {
      await recoverUnexpectedFailure(db, session, code, hardwareCommandIssued);
    } catch (recoveryError) {
      console.error("ejection failure recovery failed", safeCode(
        recoveryError instanceof Error ? recoveryError.message : "",
        "RECOVERY_FAILED",
      ));
    }
    console.error("eject-after-payment failed", code, rentalSessionId || "unknown");
    return reply({
      ok: false,
      error: hardwareCommandIssued ? "EJECTION_RECONCILIATION_REQUIRED" : code,
    }, hardwareCommandIssued ? 202 : error instanceof OrchestratorError ? 409 : 500);
  }
});
