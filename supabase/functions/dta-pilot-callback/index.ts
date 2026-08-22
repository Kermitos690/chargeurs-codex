import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, auditLog, logApi } from "../_shared/db.ts";
import { DTA_PILOT_STATION_ID, preservedMultiReleaseFailure } from "../_shared/dtaPilot.ts";
import { verifyDtaPilotCallback } from "../_shared/dtaPilotCallbackAuth.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

function firstString(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function firstInteger(source: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = source[key];
    const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isInteger(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

async function parseRequest(req: Request): Promise<Record<string, unknown>> {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    return Object.fromEntries(form.entries());
  }
  return await req.json().catch(() => ({}));
}

function parsePayload(payload: Record<string, unknown>) {
  const nested = payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
    ? payload.data as Record<string, unknown>
    : {};
  const merged = { ...payload, ...nested };
  return {
    status: firstString(merged, ["status", "rentStatus"]) ?? "",
    tradeNo: firstString(merged, ["tradeNo", "trade_no", "orderNo"]),
    eventId: firstString(merged, ["messageId", "eventId", "msgId", "id"]),
    stationId: firstString(merged, [
      "deviceId", "cabinetid", "cabinetId", "stationId", "cabinetSn",
      "givebackDeviceId", "returnDeviceId", "returnStationId",
    ]),
    batteryId: firstString(merged, [
      "batteryId", "pBatteryid", "batterySN", "batterySn", "batteryCode", "sn", "bid",
    ]),
    slotNum: firstInteger(merged, [
      "slotNum", "slot", "slotId", "position", "givebackSlot", "returnSlot",
    ]),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const runId = new URL(req.url).searchParams.get("run") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(runId)) return json({ ok: false, error: "VALID_RUN_REQUIRED" }, 400);
  if (!await verifyDtaPilotCallback(req, runId)) return json({ ok: false, error: "INVALID_CALLBACK_AUTH" }, 401);

  const db = adminClient();
  try {
    const raw = await parseRequest(req);
    const identity = parsePayload(raw);
    const { data: run, error: runError } = await db.from("hardware_qualification_runs")
      .select("*")
      .eq("id", runId)
      .eq("station_id", DTA_PILOT_STATION_ID)
      .maybeSingle();
    if (runError) throw runError;
    if (!run) return json({ received: true, unmatched: true }, 202);
    if (identity.tradeNo && run.provider_trade_no && identity.tradeNo !== run.provider_trade_no) {
      return json({ received: true, ignored: true, reason: "TRADE_NO_MISMATCH" }, 202);
    }

    const expectedBatteryId = String(run.observed_battery_id ?? run.expected_battery_id ?? "").trim() || null;
    const expectedSlotNum = run.observed_slot_num ?? run.requested_slot_num;
    const externalEventId = identity.eventId
      ?? `pilot:${identity.status}:${identity.tradeNo ?? run.provider_trade_no ?? "none"}:${identity.batteryId ?? "none"}:${identity.slotNum ?? "none"}`;
    const eventType = identity.status === "2" ? "return"
      : identity.status === "1" ? "release_success"
      : identity.status === "0" ? "release_failed"
      : "unknown";

    const { error: insertError } = await db.from("hardware_qualification_events").insert({
      run_id: runId,
      station_id: DTA_PILOT_STATION_ID,
      event_type: eventType,
      external_event_id: externalEventId,
      provider_trade_no: identity.tradeNo ?? run.provider_trade_no,
      battery_id: identity.batteryId,
      slot_num: identity.slotNum,
      payload: raw,
    });
    if ((insertError as { code?: string } | null)?.code === "23505") {
      return json({ received: true, duplicate: true });
    }
    if (insertError) throw insertError;

    await logApi(db, {
      service: "chargenow",
      endpoint: "/rent/callback",
      method: "POST",
      status_code: 200,
      request: {
        purpose: "freepay_battery_qualification",
        runId,
        status: identity.status,
        tradeNo: identity.tradeNo,
        stationId: identity.stationId,
        batteryId: identity.batteryId,
        slotNum: identity.slotNum,
      },
      response: null,
      error: null,
    });

    if (identity.status === "0") {
      await db.from("hardware_qualification_runs").update({
        state: "failed",
        failure_code: "CHARGENOW_RENT_FAILED",
        failure_message: "ChargeNow a confirmé que l'éjection de qualification a échoué.",
        updated_at: new Date().toISOString(),
      }).eq("id", runId);
      await auditLog(db, {
        action: "hardware.qualification.release_failed",
        target: runId,
        data: { trade_no_fingerprint: String(run.provider_trade_no ?? "").slice(-8) },
      });
      return json({ received: true, state: "failed" });
    }

    if (identity.status === "1") {
      if (!identity.batteryId || identity.slotNum == null) {
        await db.from("hardware_qualification_runs").update({
          state: "needs_reconciliation",
          failure_code: "RELEASE_IDENTITY_INCOMPLETE",
          failure_message: "Le callback de sortie ne contient pas la batterie et le slot nécessaires.",
          updated_at: new Date().toISOString(),
        }).eq("id", runId);
        return json({ received: true, state: "needs_reconciliation", reason: "RELEASE_IDENTITY_INCOMPLETE" }, 202);
      }
      if ((expectedBatteryId && expectedBatteryId !== identity.batteryId)
        || (expectedSlotNum != null && Number(expectedSlotNum) !== identity.slotNum)) {
        await db.from("hardware_qualification_runs").update({
          state: "needs_reconciliation",
          observed_battery_id: identity.batteryId,
          observed_slot_num: identity.slotNum,
          failure_code: "RELEASE_IDENTITY_MISMATCH",
          failure_message: "La batterie ou le slot confirmé diffère de l'inventaire réservé.",
          updated_at: new Date().toISOString(),
        }).eq("id", runId);
        return json({ received: true, state: "needs_reconciliation", reason: "RELEASE_IDENTITY_MISMATCH" }, 202);
      }
      const now = new Date().toISOString();
      const preservedIncident = preservedMultiReleaseFailure(run);
      await db.from("hardware_qualification_runs").update({
        state: "ejection_confirmed",
        observed_battery_id: identity.batteryId,
        observed_slot_num: identity.slotNum,
        ejection_confirmed_at: now,
        failure_code: preservedIncident?.code ?? null,
        failure_message: preservedIncident?.message ?? null,
        updated_at: now,
      }).eq("id", runId);
      await db.from("batteries").update({
        station_id: null,
        slot_num: null,
        status: "out_of_station",
      }).eq("battery_id", identity.batteryId);
      await auditLog(db, {
        action: "hardware.qualification.release_confirmed",
        target: runId,
        data: { battery_id: identity.batteryId, slot_num: identity.slotNum },
      });
      return json({ received: true, state: "ejection_confirmed" });
    }

    if (identity.status === "2") {
      if (!identity.batteryId || !identity.stationId || identity.slotNum == null) {
        await db.from("hardware_qualification_runs").update({
          state: "needs_reconciliation",
          failure_code: "RETURN_IDENTITY_INCOMPLETE",
          failure_message: "Le callback de retour ne contient pas la batterie, la borne et le slot nécessaires.",
          updated_at: new Date().toISOString(),
        }).eq("id", runId);
        return json({ received: true, state: "needs_reconciliation", reason: "RETURN_IDENTITY_INCOMPLETE" }, 202);
      }
      if (!expectedBatteryId || expectedBatteryId !== identity.batteryId) {
        await db.from("hardware_qualification_runs").update({
          state: "needs_reconciliation",
          observed_battery_id: identity.batteryId,
          observed_slot_num: identity.slotNum,
          failure_code: "RETURN_BATTERY_MISMATCH",
          failure_message: "La batterie retournée n'est pas celle du cycle de qualification.",
          updated_at: new Date().toISOString(),
        }).eq("id", runId);
        return json({ received: true, state: "needs_reconciliation", reason: "RETURN_BATTERY_MISMATCH" }, 202);
      }
      if (identity.stationId !== DTA_PILOT_STATION_ID) {
        await db.from("hardware_qualification_runs").update({
          state: "needs_reconciliation",
          observed_battery_id: identity.batteryId,
          observed_slot_num: identity.slotNum,
          failure_code: "RETURNED_TO_DIFFERENT_STATION",
          failure_message: "Pour cette campagne pilote, la batterie doit être rendue à DTA21269.",
          updated_at: new Date().toISOString(),
        }).eq("id", runId);
        return json({ received: true, state: "needs_reconciliation", reason: "RETURNED_TO_DIFFERENT_STATION" }, 202);
      }

      const now = new Date().toISOString();
      const preservedIncident = preservedMultiReleaseFailure(run);
      await db.from("hardware_qualification_runs").update({
        state: "completed",
        observed_battery_id: identity.batteryId,
        observed_slot_num: identity.slotNum,
        return_confirmed_at: now,
        completed_at: now,
        failure_code: preservedIncident?.code ?? null,
        failure_message: preservedIncident?.message ?? null,
        updated_at: now,
      }).eq("id", runId);
      await db.from("batteries").update({
        station_id: DTA_PILOT_STATION_ID,
        slot_num: identity.slotNum,
        status: "in_station",
        qualification_status: "provisional",
        capacity_confidence: "provider_only",
        pricing_eligible: false,
      }).eq("battery_id", identity.batteryId);
      await db.from("slots").upsert({
        station_id: DTA_PILOT_STATION_ID,
        slot_num: identity.slotNum,
        status: "occupied",
        battery_id: identity.batteryId,
        raw_data: raw,
      }, { onConflict: "station_id,slot_num" });
      await db.from("battery_observations").insert({
        battery_id: identity.batteryId,
        station_id: DTA_PILOT_STATION_ID,
        slot_num: identity.slotNum,
        qualification_run_id: runId,
        source: "return_event",
        provider_metric_kind: "unknown",
        raw_data: raw,
      });
      await auditLog(db, {
        action: "hardware.qualification.completed",
        target: runId,
        data: { battery_id: identity.batteryId, returned_slot_num: identity.slotNum },
      });
      return json({ received: true, state: "completed", batteryId: identity.batteryId, slotNum: identity.slotNum });
    }

    return json({ received: true, ignored: true, reason: "UNKNOWN_STATUS" });
  } catch (error) {
    console.error("dta pilot callback failed", error instanceof Error ? error.name : "UNKNOWN");
    return json({ ok: false, error: "DTA_PILOT_CALLBACK_INTERNAL_ERROR" }, 500);
  }
});
