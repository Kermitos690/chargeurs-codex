// kiosk-cabinet-snapshot — station-bound cabinet telemetry for the kiosk.
//
// Customer-facing inventory remains read-only. As a reliability fallback, a
// fresh snapshot may also reconcile an ALREADY ACTIVE rental when the exact
// rented battery is physically back in this cabinet AND a read-only ChargeNow
// order query confirms a return timestamp. The canonical signed rent callback
// still owns the business transition and Stripe settlement, so push callbacks
// and polling remain idempotent and converge on the same path.
//
// This function never sends a ChargeNow hardware mutation and never retries an
// ejection.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, auditLog, verifyKioskDevice } from "../_shared/db.ts";
import {
  isChargeNowConfigured,
  orderDetail,
  orderQuery,
} from "../_shared/chargenow.ts";
import { readCabinetSnapshot, type CabinetSnapshot } from "../_shared/cabinetSnapshot.ts";
import { buildChargeNowCallbackUrl } from "../_shared/chargenowCallbackAuth.ts";

const headers = {
  ...corsHeaders,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-kiosk-token",
  "Access-Control-Expose-Headers": "x-correlation-id",
};

type RecordValue = Record<string, unknown>;

type ReturnEvidence = {
  returnedAt: string | null;
  returnStationId: string | null;
  batteryId: string | null;
  slotNum: number | null;
};

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function firstString(source: RecordValue, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function firstInteger(source: RecordValue, keys: string[]): number | null {
  for (const key of keys) {
    const raw = source[key];
    const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    if (Number.isInteger(value) && value >= 0) return value;
  }
  return null;
}

function parsedTimestamp(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    const date = new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric);
    if (Number.isFinite(date.getTime())) return date.toISOString();
  }
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function parseReturnEvidence(payload: unknown): ReturnEvidence {
  const root = isRecord(payload) ? payload : {};
  const nested = isRecord(root.data) ? root.data : {};
  const order = isRecord(nested.order) ? nested.order : isRecord(root.order) ? root.order : {};
  const merged = { ...root, ...nested, ...order };
  return {
    returnedAt: parsedTimestamp(
      merged.pGhtime
      ?? merged.pGivebackTime
      ?? merged.givebackTime
      ?? merged.returnTime
      ?? merged.pReturnTime,
    ),
    returnStationId: firstString(merged, [
      "pGhCabinetId", "pGhCabinetid", "pGivebackDeviceid", "givebackDeviceId",
      "returnDeviceId", "returnCabinetId", "returnStationId",
    ]),
    batteryId: firstString(merged, [
      "batteryId", "pBatteryid", "pbatteryid", "batterySN", "batterySn",
      "batteryCode", "bid",
    ]),
    slotNum: firstInteger(merged, [
      "pGhKakou", "pGivebackSlotid", "pGivebackSlot", "givebackSlotId",
      "givebackSlot", "returnSlot", "returnedSlotNum",
    ]),
  };
}

function mergeReturnEvidence(values: ReturnEvidence[]): ReturnEvidence {
  const firstKnown = <K extends keyof ReturnEvidence>(key: K): ReturnEvidence[K] => {
    for (const value of values) {
      if (value[key] !== null) return value[key];
    }
    return null as ReturnEvidence[K];
  };
  return {
    returnedAt: firstKnown("returnedAt"),
    returnStationId: firstKnown("returnStationId"),
    batteryId: firstKnown("batteryId"),
    slotNum: firstKnown("slotNum"),
  };
}

async function reconcileConfirmedSameStationReturns(
  db: ReturnType<typeof adminClient>,
  stationId: string,
  cabinetId: string,
  snapshot: CabinetSnapshot,
): Promise<{ checked: number; reconciled: number; pending: number }> {
  const { data: sessions, error } = await db.from("rental_sessions")
    .select("id,battery_id,apifox_trade_no,started_at,ejected_at,returned_at,state")
    .eq("station_id", stationId)
    .in("state", ["active_rental", "ejected"])
    .is("returned_at", null)
    .not("battery_id", "is", null)
    .not("apifox_trade_no", "is", null)
    .limit(10);
  if (error) throw error;

  let reconciled = 0;
  let pending = 0;

  for (const session of sessions ?? []) {
    const batteryId = String(session.battery_id ?? "").trim();
    const tradeNo = String(session.apifox_trade_no ?? "").trim();
    const releaseAt = Date.parse(String(session.started_at ?? session.ejected_at ?? ""));
    if (!batteryId || !tradeNo || !Number.isFinite(releaseAt)) continue;

    // Provider inventory can lag for a few seconds immediately after release.
    // Never interpret that short window as a return.
    if (Date.now() - releaseAt < 90_000) continue;

    const physicalSlot = snapshot.slots.find((slot) =>
      slot.battery_id === batteryId
      && slot.battery_present === true
      && slot.confidence === "high"
      && slot.conflicts.length === 0
      && slot.data_age_seconds != null
      && slot.data_age_seconds < 300
    );
    if (!physicalSlot) continue;

    // A physical reappearance alone is deliberately insufficient. Confirm the
    // provider order with read-only O3/O5 before entering the canonical return
    // pipeline.
    const [detail, status] = await Promise.all([
      orderDetail(tradeNo),
      orderQuery(tradeNo),
    ]);
    const evidence = mergeReturnEvidence([
      detail.ok ? parseReturnEvidence(detail.data) : parseReturnEvidence(null),
      status.ok ? parseReturnEvidence(status.data) : parseReturnEvidence(null),
    ]);

    if (!evidence.returnedAt) {
      pending += 1;
      continue;
    }
    if (evidence.batteryId && evidence.batteryId !== batteryId) {
      pending += 1;
      await auditLog(db, {
        action: "rental.return.poll_mismatch",
        target: String(session.id),
        data: {
          station_id: stationId,
          expected_battery_id: batteryId,
          provider_battery_id: evidence.batteryId,
          trade_no_fingerprint: tradeNo.slice(-8),
        },
      });
      continue;
    }
    if (
      evidence.returnStationId
      && evidence.returnStationId !== stationId
      && evidence.returnStationId !== cabinetId
    ) {
      pending += 1;
      continue;
    }
    if (evidence.slotNum != null && evidence.slotNum > 0 && evidence.slotNum !== physicalSlot.slot_num) {
      pending += 1;
      continue;
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    if (!supabaseUrl) {
      pending += 1;
      continue;
    }
    const callbackUrl = await buildChargeNowCallbackUrl(supabaseUrl, String(session.id));
    const response = await fetch(callbackUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "2",
        tradeNo,
        eventId: `poll-return:${tradeNo}:${evidence.returnedAt}`,
        stationId,
        batteryId,
        slotNum: physicalSlot.slot_num,
      }),
    });
    const result = await response.json().catch(() => null) as RecordValue | null;
    if (response.ok && (result?.received === true || result?.duplicate === true)) {
      reconciled += 1;
      await auditLog(db, {
        action: "rental.return.reconciled_from_poll",
        target: String(session.id),
        data: {
          station_id: stationId,
          battery_id: batteryId,
          slot_num: physicalSlot.slot_num,
          returned_at: evidence.returnedAt,
          trade_no_fingerprint: tradeNo.slice(-8),
        },
      });
    } else {
      pending += 1;
    }
  }

  return { checked: sessions?.length ?? 0, reconciled, pending };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  const correlationId = crypto.randomUUID();
  const json = (body: unknown, status = 200) => new Response(JSON.stringify({ ...(body as object), correlationId }), {
    status,
    headers: { ...headers, "Content-Type": "application/json", "X-Correlation-Id": correlationId },
  });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const stationId = typeof body.stationId === "string" ? body.stationId.trim() : "";
    if (!/^[A-Za-z0-9_-]{4,32}$/.test(stationId)) return json({ ok: false, error: "MISSING_STATION" }, 400);

    const db = adminClient();
    const auth = await verifyKioskDevice(req, db, stationId);
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
    if (!isChargeNowConfigured()) return json({ ok: false, configured: false, error: "CHARGENOW_NOT_CONFIGURED" }, 409);

    const { data: station } = await db.from("stations")
      .select("station_id,cabinet_id")
      .eq("station_id", stationId)
      .maybeSingle();
    if (!station) return json({ ok: false, error: "STATION_NOT_FOUND" }, 404);

    const cabinetId = station.cabinet_id || station.station_id;
    const snapshot = await readCabinetSnapshot(cabinetId);

    // Best-effort business reconciliation. Failure never blocks the customer
    // from seeing inventory; it only leaves the return pending for the next
    // poll/operator review.
    let returnReconciliation = { checked: 0, reconciled: 0, pending: 0 };
    try {
      returnReconciliation = await reconcileConfirmedSameStationReturns(
        db,
        stationId,
        cabinetId,
        snapshot,
      );
    } catch (error) {
      console.error(
        "kiosk-cabinet-snapshot return reconciliation",
        error instanceof Error ? error.message : "UNKNOWN_ERROR",
      );
    }

    const slots = snapshot.slots.map((slot) => ({
      slot_num: slot.slot_num,
      charge_percent: slot.customer_status === "return_available" ? null : slot.charge_percent,
      rentable: slot.rentable,
      confidence: slot.confidence,
      status: slot.customer_status,
      recommended: false,
    }));

    const candidates = snapshot.slots
      .filter((slot) =>
        slot.rentable
        && slot.charge_percent != null
        && slot.confidence === "high"
        && slot.self_check !== "fail"
        && !slot.error_code
        && !slot.fault_type
        && !slot.fault_cause
        && slot.temperature_c != null
        && slot.temperature_c >= 0
        && slot.temperature_c <= 45
      )
      .sort((a, b) => (b.charge_percent ?? -1) - (a.charge_percent ?? -1) || a.slot_num - b.slot_num);

    const recommended = candidates[0];
    const displayRecommendation = slots.find((slot) => slot.slot_num === recommended?.slot_num);
    if (displayRecommendation) {
      displayRecommendation.recommended = true;
      displayRecommendation.status = "recommended";
    }

    return json({
      ok: true,
      configured: true,
      online: snapshot.online,
      slots,
      sources: snapshot.sources,
      returnReconciliation,
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("kiosk-cabinet-snapshot", error instanceof Error ? error.message : "UNKNOWN_ERROR");
    return json({ ok: false, error: "SNAPSHOT_UNAVAILABLE" }, 503);
  }
});