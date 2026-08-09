// Reconcile an asynchronous ChargeNow ejection using read-only supplier state.
//
// This function intentionally NEVER calls an ejection endpoint. It can only
// convert a paid rental from `ejecting` to `ejected` after the selected slot is
// observed empty and the battery identity was reserved before payment.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, auditLog, verifyKioskDevice } from "../_shared/db.ts";
import { isChargeNowConfigured } from "../_shared/chargenow.ts";
import { readCabinetSnapshot } from "../_shared/cabinetSnapshot.ts";
import { appendRentalEvent, OrchestratorError } from "../_shared/rentalOrchestratorRuntime.ts";

const headers = {
  ...corsHeaders,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-kiosk-token",
  "Access-Control-Expose-Headers": "x-correlation-id",
};

const json = (correlationId: string, body: Record<string, unknown>, status = 200) => new Response(
  JSON.stringify({ ...body, correlationId }),
  { status, headers: { ...headers, "Content-Type": "application/json", "X-Correlation-Id": correlationId } },
);

function validUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f-]{27}[0-9a-f]$/i.test(value);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  const correlationId = crypto.randomUUID();
  if (req.method !== "POST") return json(correlationId, { ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const stationId = typeof body.stationId === "string" ? body.stationId.trim() : "";
    const rentalSessionId = body.rentalSessionId;
    const publicCode = typeof body.publicCode === "string" ? body.publicCode.trim() : "";
    if (!/^[A-Za-z0-9_-]{4,32}$/.test(stationId) || !validUuid(rentalSessionId) || !publicCode) {
      return json(correlationId, { ok: false, error: "INVALID_RECONCILIATION_REQUEST" }, 400);
    }

    const db = adminClient();
    const kiosk = await verifyKioskDevice(req, db, stationId);
    if (!kiosk.ok) return json(correlationId, { ok: false, error: kiosk.error }, kiosk.status);
    if (!isChargeNowConfigured()) return json(correlationId, { ok: false, error: "CHARGENOW_NOT_CONFIGURED" }, 409);

    const { data: session, error: sessionError } = await db.from("rental_sessions")
      .select("id,station_id,cabinet_id,public_session_code,state,chargenow_status,failure_code,selected_slot_num,battery_id,stripe_payment_intent_id,apifox_trade_no,ejected_at,started_at")
      .eq("id", rentalSessionId).eq("station_id", stationId).eq("public_session_code", publicCode).maybeSingle();
    if (sessionError) throw sessionError;
    if (!session) return json(correlationId, { ok: false, error: "RENTAL_SESSION_NOT_FOUND" }, 404);

    if (["ejected", "active_rental", "battery_taken", "completed"].includes(String(session.state))) {
      return json(correlationId, { ok: true, state: session.state, alreadyReconciled: true });
    }
    if (session.state !== "ejecting" || session.chargenow_status !== "release_provider_confirmation_pending") {
      return json(correlationId, { ok: true, state: session.state, reconcilable: false });
    }

    const slotNum = Number(session.selected_slot_num);
    const batteryId = typeof session.battery_id === "string" ? session.battery_id.trim() : "";
    if (!Number.isInteger(slotNum) || slotNum < 1 || !batteryId) {
      await auditLog(db, {
        action: "rental.release.reconciliation_identity_incomplete",
        target: String(session.id),
        data: { station_id: stationId, selected_slot_num: session.selected_slot_num ?? null },
      });
      return json(correlationId, { ok: true, state: "ejecting", confirmed: false, reason: "RELEASE_IDENTITY_INCOMPLETE" }, 202);
    }

    const cabinetId = String(session.cabinet_id ?? stationId).trim() || stationId;
    const snapshot = await readCabinetSnapshot(cabinetId);
    const slot = snapshot.slots.find((item) => item.slot_num === slotNum);
    // An empty selected compartment is the only evidence accepted here. A
    // missing field, stale record, or another slot becoming empty never marks
    // this rental complete and never triggers another hardware command.
    if (!slot || slot.battery_present !== false) {
      await auditLog(db, {
        action: "rental.release.reconciliation_pending",
        target: String(session.id),
        data: {
          station_id: stationId,
          cabinet_id: cabinetId,
          slot_num: slotNum,
          observed_present: slot?.battery_present ?? null,
          snapshot_sources: snapshot.sources,
        },
      });
      return json(correlationId, { ok: true, state: "ejecting", confirmed: false, reason: "AWAITING_PROVIDER_SLOT_EMPTY" }, 202);
    }

    const releasedAt = new Date().toISOString();
    const tradeNo = String(session.apifox_trade_no ?? "") || String(session.id);
    await appendRentalEvent(db, {
      rentalId: String(session.id), eventType: "battery_released",
      idempotencyKey: `battery_released:reconciliation:${tradeNo}:${batteryId}`,
      paymentIntentId: String(session.stripe_payment_intent_id ?? "") || null,
      stationId, batteryId, occurredAt: releasedAt,
      metadata: { cabinetId, slotNum, tradeNo, source: "supplier_slot_snapshot" },
    });
    await appendRentalEvent(db, {
      rentalId: String(session.id), eventType: "rental_activated",
      idempotencyKey: `rental_activated:reconciliation:${tradeNo}:${batteryId}`,
      paymentIntentId: String(session.stripe_payment_intent_id ?? "") || null,
      stationId, batteryId, occurredAt: releasedAt,
      metadata: { cabinetId, slotNum, tradeNo, source: "supplier_slot_snapshot" },
    });

    const { data: updated, error: updateError } = await db.from("rental_sessions").update({
      state: "ejected", ejected_at: session.ejected_at ?? releasedAt,
      started_at: session.started_at ?? releasedAt, chargenow_status: "ejected",
      failure_code: null, failure_message: null,
    }).eq("id", session.id).eq("state", "ejecting").select("id");
    if (updateError) throw updateError;
    if (!updated?.length) return json(correlationId, { ok: true, state: "ejecting", confirmed: false, reason: "RECONCILIATION_RACE" }, 202);

    await auditLog(db, {
      action: "rental.release.reconciled_from_supplier_snapshot",
      target: String(session.id),
      data: { station_id: stationId, cabinet_id: cabinetId, slot_num: slotNum, battery_id: batteryId },
    });
    return json(correlationId, { ok: true, state: "ejected", confirmed: true, slotNum });
  } catch (error) {
    const code = error instanceof OrchestratorError ? error.code : "RECONCILIATION_UNAVAILABLE";
    console.error("reconcile-pending-ejection", code);
    return json(correlationId, { ok: false, error: code }, 503);
  }
});
