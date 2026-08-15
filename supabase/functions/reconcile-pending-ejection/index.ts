// Read-only physical release reconciler. It never sends or retries an eject command.
// A multi-release is terminal for that rental: it must never be silently
// accepted just because the selected battery also happened to leave.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, verifyKioskDevice } from "../_shared/db.ts";
import { readCabinetSnapshot } from "../_shared/cabinetSnapshot.ts";

const headers = {
  ...corsHeaders,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-kiosk-token",
  "Access-Control-Expose-Headers": "x-correlation-id",
};
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f-]{27}[0-9a-f]$/i.test(v);
const trustworthy = (s: any) => Boolean(s && s.confidence !== "low" && Array.isArray(s.conflicts) && s.conflicts.length === 0);
// ChargeNow can emit two physical events several seconds after the HTTP answer.
// Do not accept an early one-slot snapshot before that supplier event window has
// closed; the kiosk keeps polling this read-only endpoint while it waits.
const PHYSICAL_OBSERVATION_WINDOW_MS = 30_000;
function classify(pre: any, post: any, selected: number) {
  const pm = new Map((post.slots ?? []).map((s: any) => [Number(s.slot_num), s]));
  const released = (pre.slots ?? [])
    .filter((s: any) => s.battery_present === true && s.battery_id)
    .filter((s: any) => {
      const p: any = pm.get(Number(s.slot_num));
      if (!trustworthy(p)) return false;
      return p.battery_present === false || p.battery_id !== s.battery_id;
    });
  const nums = released.map((s: any) => Number(s.slot_num)).sort((a: number, b: number) => a - b);
  const ids = released.map((s: any) => String(s.battery_id)).filter(Boolean);
  return {
    result: nums.length > 1 ? "multi_release" : nums.length === 1 && nums[0] === selected ? "single_release" : nums.length === 1 ? "unexpected_release" : "pending",
    released_slot_nums: nums,
    released_battery_ids: ids,
  };
}
async function appendCanonical(d: any, session: any, eventType: string, targetState: string, key: string, at: string, metadata: any) {
  const { data: s, error } = await d.from("rental_orchestrator_snapshots").select("state,version").eq("rental_id", session.id).maybeSingle();
  if (error) throw error;
  if (!s) return false;
  if (String(s.state) === targetState || (eventType === "battery_released" && ["active", "return_detected", "pricing_finalized", "payment_captured", "completed"].includes(String(s.state)))) return true;
  const { error: e } = await d.rpc("append_rental_orchestrator_event", {
    p_rental_id: session.id,
    p_expected_version: Number(s.version ?? 0),
    p_event_type: eventType,
    p_idempotency_key: key,
    p_occurred_at: at,
    p_metadata: metadata,
    p_resulting_state: targetState,
    p_payment_intent_id: session.stripe_payment_intent_id ?? null,
    p_station_id: session.station_id,
    p_battery_id: session.battery_id ?? null,
    p_final_amount_chf: null,
    p_failure_reason: null,
  });
  if (e) {
    if (String(e.message ?? "").includes("IDEMPOTENCY_KEY_CONFLICT")) return true;
    throw e;
  }
  return true;
}
async function recordAnomaly(d: any, session: any, delta: any, kind: "multi" | "unexpected" | "mismatch", post: any) {
  const now = new Date().toISOString();
  const code = kind === "multi" ? "MULTI_BATTERY_RELEASE_OBSERVED" : kind === "mismatch" ? "RELEASE_BATTERY_MISMATCH" : "UNEXPECTED_BATTERY_RELEASE_OBSERVED";
  const details = {
    source: "automatic_post_payment_reconciliation",
    incident_at: now,
    requested_slot_num: Number(session.selected_slot_num),
    expected_battery_id: session.battery_id ?? null,
    released_slot_nums: delta.released_slot_nums,
    released_battery_ids: delta.released_battery_ids,
    reported_release_count: delta.released_slot_nums.length,
    station_quarantined: false,
    automatic_retry_allowed: false,
    post_snapshot_observed_at: post.observed_at,
  };
  await d.from("system_incidents").insert({
    type: kind === "multi" ? "multi_battery_release" : "unexpected_battery_release",
    severity: kind === "multi" ? "critical" : "high",
    message: kind === "multi"
      ? "Plusieurs batteries ont été observées sorties après une seule commande. La location est bloquée pour revue manuelle; aucune activation ou capture automatique n'est autorisée."
      : "Une sortie physique ne correspond pas à la batterie sélectionnée. La borne reste disponible; cette location requiert une réconciliation.",
    data: { rental_session_id: session.id, station_id: session.station_id, code, ...details },
    resolved: false,
    rental_session_id: session.id,
    station_id: session.station_id,
  });
  await d.from("audit_logs").insert({ actor: null, action: "rental.release.anomaly_recorded_without_station_quarantine", target: String(session.id), data: { code, ...details } });
  return { code, details };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  const cid = crypto.randomUUID();
  const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify({ ...body, correlationId: cid }), {
    status,
    headers: { ...headers, "Content-Type": "application/json", "X-Correlation-Id": cid },
  });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const stationId = typeof body.stationId === "string" ? body.stationId.trim() : "";
    const rentalSessionId = body.rentalSessionId;
    if (!/^[A-Za-z0-9_-]{4,32}$/.test(stationId) || !uuid(rentalSessionId)) return json({ ok: false, error: "INVALID_RECONCILIATION_REQUEST" }, 400);
    const d = adminClient();
    const kiosk = await verifyKioskDevice(req, d, stationId);
    if (!kiosk.ok) return json({ ok: false, error: kiosk.error }, kiosk.status);
    const { data: session, error: se } = await d.from("rental_sessions")
      .select("id,station_id,cabinet_id,kiosk_device_id,public_session_code,state,chargenow_status,selected_slot_num,battery_id,stripe_payment_intent_id,apifox_trade_no,ejected_at,started_at")
      .eq("id", rentalSessionId).eq("station_id", stationId).eq("kiosk_device_id", kiosk.device.id).maybeSingle();
    if (se) throw se;
    if (!session) return json({ ok: false, error: "RENTAL_SESSION_NOT_FOUND" }, 404);
    const suppliedCode = typeof body.publicCode === "string" ? body.publicCode.trim() : "";
    if (suppliedCode && suppliedCode !== session.public_session_code) return json({ ok: false, error: "PUBLIC_CODE_MISMATCH" }, 403);
    if (["ejected", "active_rental", "battery_taken", "battery_returned", "completed"].includes(String(session.state))) return json({ ok: true, state: session.state, alreadyReconciled: true });
    if (session.state !== "ejecting") return json({ ok: true, state: session.state, reconcilable: false });

    const slot = Number(session.selected_slot_num);
    const bid = String(session.battery_id ?? "").trim();
    if (!Number.isInteger(slot) || slot < 1 || !bid) return json({ ok: true, state: "ejecting", confirmed: false, reason: "RELEASE_IDENTITY_INCOMPLETE" }, 202);
    const { data: attempt, error: ae } = await d.from("hardware_release_attempts").select("id,pre_snapshot,result,command_sent_at").eq("rental_session_id", session.id).maybeSingle();
    if (ae) throw ae;
    if (!attempt?.pre_snapshot) return json({ ok: true, state: "ejecting", confirmed: false, reason: "RELEASE_BASELINE_MISSING" }, 202);
    if (!attempt.command_sent_at) return json({ ok: true, state: "ejecting", confirmed: false, reason: "EJECT_COMMAND_NOT_YET_OBSERVED" }, 202);
    const commandAtMs = Date.parse(String(attempt.command_sent_at));
    if (!Number.isFinite(commandAtMs) || Date.now() - commandAtMs < PHYSICAL_OBSERVATION_WINDOW_MS) {
      return json({ ok: true, state: "ejecting", confirmed: false, reason: "AWAITING_PHYSICAL_OBSERVATION_WINDOW" }, 202);
    }

    const cabinetId = String(session.cabinet_id ?? stationId).trim() || stationId;
    const live = await readCabinetSnapshot(cabinetId);
    const post = {
      cabinet_id: cabinetId,
      observed_at: new Date().toISOString(),
      slots: live.slots.map((s: any) => ({ slot_num: s.slot_num, battery_id: s.battery_id, battery_present: s.battery_present, confidence: s.confidence, conflicts: s.conflicts })),
    };
    const delta = classify(attempt.pre_snapshot, post, slot);
    const now = new Date().toISOString();
    await d.from("hardware_release_attempts").update({
      post_snapshot: post,
      result: delta.result,
      released_slot_nums: delta.released_slot_nums,
      released_battery_ids: delta.released_battery_ids,
      reconciled_at: delta.result === "pending" ? null : now,
      updated_at: now,
    }).eq("id", attempt.id);

    const selectedReleased = delta.released_slot_nums.includes(slot) && delta.released_battery_ids.includes(bid);
    if (delta.result === "multi_release") {
      const anomaly = await recordAnomaly(d, session, delta, "multi", post);
      await d.from("rental_sessions").update({
        state: "needs_support",
        failure_code: anomaly.code,
        failure_message: "Plusieurs batteries sont sorties pour une seule location. Aucune activation ni capture automatique n'est autorisée.",
        chargenow_status: "multi_release_detected",
        updated_at: now,
      }).eq("id", session.id).eq("state", "ejecting");
      return json({ ok: false, state: "needs_support", confirmed: false, error: anomaly.code, stationQuarantined: false, releasedSlotNums: delta.released_slot_nums }, 202);
    } else if (delta.result === "unexpected_release") {
      const anomaly = await recordAnomaly(d, session, delta, "unexpected", post);
      await d.from("rental_sessions").update({
        state: "needs_support",
        failure_code: anomaly.code,
        failure_message: "Une batterie différente de celle sélectionnée est sortie. Aucune nouvelle éjection automatique n'est envoyée.",
        chargenow_status: "unexpected_release_detected",
        updated_at: now,
      }).eq("id", session.id).eq("state", "ejecting");
      return json({ ok: false, state: "needs_support", confirmed: false, error: anomaly.code, stationQuarantined: false, releasedSlotNums: delta.released_slot_nums }, 202);
    } else if (delta.result !== "single_release") {
      return json({ ok: true, state: "ejecting", confirmed: false, reason: "AWAITING_RELEASE_CONFIRMATION", releasedSlotNums: delta.released_slot_nums }, 202);
    }

    if (!selectedReleased) {
      const anomaly = await recordAnomaly(d, session, delta, "mismatch", post);
      await d.from("rental_sessions").update({
        state: "needs_support",
        failure_code: anomaly.code,
        failure_message: "La batterie physiquement sortie ne correspond pas à la batterie sélectionnée.",
        chargenow_status: "release_battery_mismatch",
        updated_at: now,
      }).eq("id", session.id).eq("state", "ejecting");
      return json({ ok: false, state: "needs_support", confirmed: false, error: anomaly.code, stationQuarantined: false }, 202);
    }

    const tradeNo = String(session.apifox_trade_no ?? "") || String(session.id);
    const meta = {
      cabinetId,
      slotNum: slot,
      tradeNo,
      source: "four_source_physical_consensus",
      providerCallbackRequired: false,
      multi_release_observed: false,
      releasedSlotNums: delta.released_slot_nums,
      releasedBatteryIds: delta.released_battery_ids,
    };
    await appendCanonical(d, session, "battery_released", "released", `battery_released:physical_delta:${tradeNo}:${bid}`, now, meta);
    await appendCanonical(d, session, "rental_activated", "active", `rental_activated:physical_delta:${tradeNo}:${bid}`, now, meta);
    const { data: updated, error: ue } = await d.from("rental_sessions").update({
      state: "ejected",
      ejected_at: session.ejected_at ?? now,
      started_at: session.started_at ?? now,
      chargenow_status: "ejected",
      failure_code: null,
      failure_message: null,
      updated_at: now,
    }).eq("id", session.id).eq("state", "ejecting").select("id");
    if (ue) throw ue;
    if (updated?.length) {
      await d.from("station_slot_reservations").update({ state: "released", released_at: now, release_reason: "physical_ejection_confirmed", updated_at: now }).eq("rental_session_id", session.id).eq("state", "reserved");
      for (const releasedBatteryId of delta.released_battery_ids) {
        await d.from("batteries").update({ station_id: null, slot_num: null, status: "out_of_station", updated_at: now }).eq("battery_id", releasedBatteryId);
      }
    }
    return json({ ok: true, state: updated?.length ? "ejected" : "ejecting", confirmed: Boolean(updated?.length), slotNum: slot, stationQuarantined: false, anomalyRecorded: false });
  } catch (e) {
    console.error("reconcile-pending-ejection", e instanceof Error ? e.message : "RECONCILIATION_UNAVAILABLE");
    return json({ ok: false, error: "RECONCILIATION_UNAVAILABLE" }, 503);
  }
});
