// Reconcile a ChargeNow C3 command using read-only cabinet state only.
//
// Exactly-once API calls are not enough: a single provider command can still
// produce multiple physical releases. This function compares the four-slot
// baseline saved before payment with a fresh post-command snapshot. A rental is
// activated only when exactly the selected compartment became explicitly empty.
// It NEVER calls an ejection endpoint and NEVER retries a hardware command.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, auditLog, verifyKioskDevice } from "../_shared/db.ts";
import { isChargeNowConfigured } from "../_shared/chargenow.ts";
import { readCabinetSnapshot } from "../_shared/cabinetSnapshot.ts";
import { appendRentalEvent, OrchestratorError } from "../_shared/rentalOrchestratorRuntime.ts";
import {
  classifyReleaseDelta,
  safeReleaseSnapshot,
  type SafeReleaseSnapshot,
} from "../_shared/releaseObservation.ts";

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

function isSafeBaseline(value: unknown): value is SafeReleaseSnapshot {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.cabinet_id === "string" && Array.isArray(row.slots);
}

async function quarantineStation(
  db: ReturnType<typeof adminClient>,
  session: Record<string, any>,
  code: "MULTI_RELEASE_DETECTED" | "UNEXPECTED_RELEASE_DETECTED",
  delta: ReturnType<typeof classifyReleaseDelta>,
  postSnapshot: SafeReleaseSnapshot,
) {
  const now = new Date().toISOString();
  const details = {
    rental_session_id: session.id,
    trade_no: session.apifox_trade_no ?? null,
    selected_slot_num: session.selected_slot_num,
    expected_battery_id: session.battery_id ?? null,
    released_slot_nums: delta.released_slot_nums,
    released_battery_ids: delta.released_battery_ids,
    automatic_retry_allowed: false,
    observed_at: postSnapshot.observed_at,
  };

  const { error: quarantineError } = await db.from("station_hardware_quarantines").upsert({
    station_id: session.station_id,
    active: true,
    reason_code: code,
    source_rental_session_id: session.id,
    details,
    updated_at: now,
    cleared_at: null,
    cleared_by: null,
  }, { onConflict: "station_id" });
  if (quarantineError) throw quarantineError;

  const { error: incidentError } = await db.from("system_incidents").insert({
    type: code === "MULTI_RELEASE_DETECTED" ? "multi_battery_release" : "unexpected_battery_release",
    severity: "critical",
    message: code === "MULTI_RELEASE_DETECTED"
      ? "Une commande d'éjection a provoqué plusieurs sorties physiques. La borne est mise en quarantaine."
      : "Une batterie différente du slot demandé a été observée comme sortie. La borne est mise en quarantaine.",
    data: details,
    resolved: false,
    rental_session_id: session.id,
    station_id: session.station_id,
  });
  if (incidentError) throw incidentError;

  const { error: sessionUpdateError } = await db.from("rental_sessions").update({
    state: "needs_support",
    chargenow_status: code === "MULTI_RELEASE_DETECTED" ? "multi_release_detected" : "unexpected_release_detected",
    failure_code: code,
    failure_message: "Réconciliation matérielle obligatoire. Aucune nouvelle éjection automatique n'est autorisée.",
  }).eq("id", session.id).eq("state", "ejecting");
  if (sessionUpdateError) throw sessionUpdateError;

  try {
    await appendRentalEvent(db, {
      rentalId: String(session.id),
      eventType: "rental_failed",
      idempotencyKey: `physical_release_anomaly:${session.id}:${code}`,
      paymentIntentId: String(session.stripe_payment_intent_id ?? "") || null,
      stationId: String(session.station_id ?? "") || null,
      batteryId: String(session.battery_id ?? "") || null,
      failureReason: code,
      metadata: details,
    });
  } catch (error) {
    // Legacy UI projection is still quarantined even if an old orchestrator
    // state cannot accept the terminal event. Never undo the safety block.
    await auditLog(db, {
      action: "rental.release.anomaly_orchestrator_pending",
      target: String(session.id),
      data: { code, error: error instanceof OrchestratorError ? error.code : "ORCHESTRATOR_UPDATE_FAILED" },
    });
  }

  await auditLog(db, {
    action: "station.hardware.quarantined",
    target: String(session.station_id),
    data: { code, ...details },
  });
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
      .eq("id", rentalSessionId)
      .eq("station_id", stationId)
      .eq("public_session_code", publicCode)
      .maybeSingle();
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

    const { data: attempt, error: attemptError } = await db.from("hardware_release_attempts")
      .select("id,pre_snapshot,result")
      .eq("rental_session_id", session.id)
      .maybeSingle();
    if (attemptError) throw attemptError;
    if (!attempt || !isSafeBaseline(attempt.pre_snapshot)) {
      await auditLog(db, {
        action: "rental.release.reconciliation_baseline_missing",
        target: String(session.id),
        data: { station_id: stationId, slot_num: slotNum },
      });
      return json(correlationId, {
        ok: true,
        state: "ejecting",
        confirmed: false,
        reason: "RELEASE_BASELINE_MISSING",
      }, 202);
    }

    const cabinetId = String(session.cabinet_id ?? stationId).trim() || stationId;
    const providerSnapshot = await readCabinetSnapshot(cabinetId);
    const postSnapshot = safeReleaseSnapshot(providerSnapshot);
    const delta = classifyReleaseDelta(attempt.pre_snapshot, postSnapshot, slotNum);
    const now = new Date().toISOString();

    const { error: attemptUpdateError } = await db.from("hardware_release_attempts").update({
      post_snapshot: postSnapshot,
      result: delta.result,
      released_slot_nums: delta.released_slot_nums,
      released_battery_ids: delta.released_battery_ids,
      command_sent_at: now,
      reconciled_at: delta.result === "pending" ? null : now,
      updated_at: now,
    }).eq("id", attempt.id);
    if (attemptUpdateError) throw attemptUpdateError;

    if (delta.result === "multi_release" || delta.result === "unexpected_release") {
      const code = delta.result === "multi_release" ? "MULTI_RELEASE_DETECTED" : "UNEXPECTED_RELEASE_DETECTED";
      await quarantineStation(db, session, code, delta, postSnapshot);
      return json(correlationId, {
        ok: false,
        state: "needs_support",
        confirmed: false,
        error: code,
        stationQuarantined: true,
        releasedSlotNums: delta.released_slot_nums,
      }, 202);
    }

    if (delta.result !== "single_release") {
      await auditLog(db, {
        action: "rental.release.reconciliation_pending",
        target: String(session.id),
        data: {
          station_id: stationId,
          cabinet_id: cabinetId,
          slot_num: slotNum,
          delta_result: delta.result,
          snapshot_sources: providerSnapshot.sources,
        },
      });
      return json(correlationId, { ok: true, state: "ejecting", confirmed: false, reason: "AWAITING_SINGLE_PHYSICAL_RELEASE" }, 202);
    }

    if (delta.released_battery_ids.length !== 1 || delta.released_battery_ids[0] !== batteryId) {
      await quarantineStation(db, session, "UNEXPECTED_RELEASE_DETECTED", delta, postSnapshot);
      return json(correlationId, {
        ok: false,
        state: "needs_support",
        confirmed: false,
        error: "RELEASE_BATTERY_MISMATCH",
        stationQuarantined: true,
      }, 202);
    }

    const releasedAt = now;
    const tradeNo = String(session.apifox_trade_no ?? "") || String(session.id);
    await appendRentalEvent(db, {
      rentalId: String(session.id),
      eventType: "battery_released",
      idempotencyKey: `battery_released:physical_delta:${tradeNo}:${batteryId}`,
      paymentIntentId: String(session.stripe_payment_intent_id ?? "") || null,
      stationId,
      batteryId,
      occurredAt: releasedAt,
      metadata: { cabinetId, slotNum, tradeNo, source: "four_slot_physical_delta" },
    });
    await appendRentalEvent(db, {
      rentalId: String(session.id),
      eventType: "rental_activated",
      idempotencyKey: `rental_activated:physical_delta:${tradeNo}:${batteryId}`,
      paymentIntentId: String(session.stripe_payment_intent_id ?? "") || null,
      stationId,
      batteryId,
      occurredAt: releasedAt,
      metadata: { cabinetId, slotNum, tradeNo, source: "four_slot_physical_delta" },
    });

    const { data: updated, error: updateError } = await db.from("rental_sessions").update({
      state: "ejected",
      ejected_at: session.ejected_at ?? releasedAt,
      started_at: session.started_at ?? releasedAt,
      chargenow_status: "ejected",
      failure_code: null,
      failure_message: null,
    }).eq("id", session.id).eq("state", "ejecting").select("id");
    if (updateError) throw updateError;
    if (!updated?.length) return json(correlationId, { ok: true, state: "ejecting", confirmed: false, reason: "RECONCILIATION_RACE" }, 202);

    await auditLog(db, {
      action: "rental.release.reconciled_from_four_slot_delta",
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
