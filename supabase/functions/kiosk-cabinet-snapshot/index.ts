// kiosk-cabinet-snapshot — station-bound and read-only. Raw supplier fields
// remain server-side; the kiosk only receives safe display values.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, auditLog, verifyKioskDevice } from "../_shared/db.ts";
import { isChargeNowConfigured } from "../_shared/chargenow.ts";
import { readCabinetSnapshot } from "../_shared/cabinetSnapshot.ts";
import { appendRentalEvent } from "../_shared/rentalOrchestratorRuntime.ts";

const headers = {
  ...corsHeaders,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-kiosk-token",
  "Access-Control-Expose-Headers": "x-correlation-id",
};

// This is deliberately not a dispenser operation. It is a narrow recovery for
// the provider's asynchronous C3 response: after a *recent paid* request, a
// later normal inventory read can prove that the exact selected slot is empty.
// No supplier write, retry, slot substitution, or inference from another slot
// is allowed here.
async function reconcileRecentPendingRelease(
  db: ReturnType<typeof adminClient>,
  stationId: string,
  cabinetId: string,
  snapshot: Awaited<ReturnType<typeof readCabinetSnapshot>>,
) {
  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { data: pending, error } = await db.from("rental_sessions")
    .select("id,selected_slot_num,battery_id,stripe_payment_intent_id,apifox_trade_no,ejected_at,started_at")
    .eq("station_id", stationId)
    .eq("state", "ejecting")
    .eq("chargenow_status", "release_provider_confirmation_pending")
    .gte("paid_at", since);
  if (error) throw error;

  for (const session of pending ?? []) {
    const slotNum = Number(session.selected_slot_num);
    const batteryId = typeof session.battery_id === "string" ? session.battery_id.trim() : "";
    const slot = snapshot.slots.find((candidate) => candidate.slot_num === slotNum);
    if (!Number.isInteger(slotNum) || slotNum < 1 || !batteryId || slot?.battery_present !== false) continue;

    const releasedAt = new Date().toISOString();
    const tradeNo = String(session.apifox_trade_no ?? "") || String(session.id);
    await appendRentalEvent(db, {
      rentalId: String(session.id), eventType: "battery_released",
      idempotencyKey: `battery_released:reconciliation:${tradeNo}:${batteryId}`,
      paymentIntentId: String(session.stripe_payment_intent_id ?? "") || null,
      stationId, batteryId, occurredAt: releasedAt,
      metadata: { cabinetId, slotNum, tradeNo, source: "kiosk_inventory_refresh" },
    });
    await appendRentalEvent(db, {
      rentalId: String(session.id), eventType: "rental_activated",
      idempotencyKey: `rental_activated:reconciliation:${tradeNo}:${batteryId}`,
      paymentIntentId: String(session.stripe_payment_intent_id ?? "") || null,
      stationId, batteryId, occurredAt: releasedAt,
      metadata: { cabinetId, slotNum, tradeNo, source: "kiosk_inventory_refresh" },
    });
    const { data: updated, error: updateError } = await db.from("rental_sessions").update({
      state: "ejected", ejected_at: session.ejected_at ?? releasedAt,
      started_at: session.started_at ?? releasedAt, chargenow_status: "ejected",
      failure_code: null, failure_message: null,
    }).eq("id", session.id).eq("state", "ejecting").select("id");
    if (updateError) throw updateError;
    if (updated?.length) {
      await auditLog(db, {
        action: "rental.release.reconciled_from_kiosk_inventory_refresh",
        target: String(session.id), data: { station_id: stationId, cabinet_id: cabinetId, slot_num: slotNum, battery_id: batteryId },
      });
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  const correlationId = crypto.randomUUID();
  const json = (body: unknown, status = 200) => new Response(JSON.stringify({ ...(body as object), correlationId }), {
    status, headers: { ...headers, "Content-Type": "application/json", "X-Correlation-Id": correlationId },
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
    const { data: station } = await db.from("stations").select("station_id,cabinet_id").eq("station_id", stationId).maybeSingle();
    if (!station) return json({ ok: false, error: "STATION_NOT_FOUND" }, 404);
    const snapshot = await readCabinetSnapshot(station.cabinet_id || station.station_id);
    await reconcileRecentPendingRelease(db, stationId, station.cabinet_id || station.station_id, snapshot);
    const slots = snapshot.slots.map((slot) => ({
      // An empty compartment can retain a stale supplier reading. It is a
      // return location, not a battery at 1% or a customer-facing warning.
      slot_num: slot.slot_num,
      charge_percent: slot.customer_status === "return_available" ? null : slot.charge_percent,
      rentable: slot.rentable,
      confidence: slot.confidence,
      status: slot.customer_status,
      recommended: false,
    }));

    // Recommendation is stricter than basic eligibility, but must not depend
    // on a fictitious interpretation of pCheckResult. The real C7 telemetry
    // gives charge, temperature, online state and explicit zero/non-zero fault
    // fields. A documented self-check failure blocks recommendation; an
    // unknown self-check does not, provided the independent sources agree and
    // there is no explicit fault.
    const candidates = snapshot.slots.filter((slot) =>
      slot.rentable
      && slot.charge_percent != null
      && slot.confidence === "high"
      && slot.self_check !== "fail"
      && !slot.error_code
      && !slot.fault_type
      && !slot.fault_cause
      && slot.temperature_c != null
      && slot.temperature_c >= 0
      && slot.temperature_c <= 45,
    )
      .sort((a, b) => (b.charge_percent ?? -1) - (a.charge_percent ?? -1) || a.slot_num - b.slot_num);
    const recommended = candidates[0];
    const displayRecommendation = slots.find((slot) => slot.slot_num === recommended?.slot_num);
    if (displayRecommendation) displayRecommendation.recommended = true;
    return json({ ok: true, configured: true, online: snapshot.online, slots, syncedAt: new Date().toISOString() });
  } catch (error) {
    console.error("kiosk-cabinet-snapshot", error instanceof Error ? error.message : "UNKNOWN_ERROR");
    return json({ ok: false, error: "SNAPSHOT_UNAVAILABLE" }, 503);
  }
});
