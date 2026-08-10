// cabinet-slot-diagnostics — privileged, read-only view of the multi-source
// supplier snapshot. It deliberately never returns supplier credentials or
// opaque raw payloads to a browser.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, requireAdmin } from "../_shared/db.ts";
import { isChargeNowConfigured } from "../_shared/chargenow.ts";
import { readCabinetSnapshot } from "../_shared/cabinetSnapshot.ts";

const headers = { ...corsHeaders, "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });

function ageSeconds(timestamps: Record<string, string>) {
  const values = Object.values(timestamps).map(Date.parse).filter(Number.isFinite);
  if (!values.length) return null;
  return Math.max(0, Math.round((Date.now() - Math.max(...values)) / 1000));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  const db = adminClient();
  try {
    const adminId = await requireAdmin(req, db);
    if (!adminId) return json({ ok: false, error: "FORBIDDEN" }, 403);
    const body = await req.json().catch(() => ({}));
    const stationId = typeof body.stationId === "string" ? body.stationId.trim() : "";
    if (!/^[A-Za-z0-9_-]{4,32}$/.test(stationId)) return json({ ok: false, error: "INVALID_STATION" }, 400);
    if (!isChargeNowConfigured()) return json({ ok: false, error: "CHARGENOW_NOT_CONFIGURED" }, 409);
    const { data: station, error } = await db.from("stations").select("station_id,cabinet_id").eq("station_id", stationId).maybeSingle();
    if (error) throw error;
    if (!station) return json({ ok: false, error: "STATION_NOT_FOUND" }, 404);
    const snapshot = await readCabinetSnapshot(station.cabinet_id || station.station_id);
    return json({
      ok: true,
      cabinetId: snapshot.cabinet_id,
      online: snapshot.online,
      sources: snapshot.sources,
      slots: snapshot.slots.map((slot) => ({
        slot_num: slot.slot_num, battery_id: slot.battery_id, battery_present: slot.battery_present,
        charge_percent: slot.charge_percent, temperature_c: slot.temperature_c, online: slot.online,
        health_status: slot.health_status, self_check: slot.self_check, error_code: slot.error_code,
        fault_type: slot.fault_type, fault_cause: slot.fault_cause, rentable: slot.rentable,
        confidence: slot.confidence, customer_status: slot.customer_status,
        source_timestamps: slot.source_timestamps, age_seconds: ageSeconds(slot.source_timestamps), conflicts: slot.conflicts,
        diagnostic_flags: slot.diagnostic_flags,
      })),
    });
  } catch (error) {
    console.error("cabinet-slot-diagnostics", error instanceof Error ? error.message : "UNKNOWN_ERROR");
    return json({ ok: false, error: "SNAPSHOT_UNAVAILABLE" }, 503);
  }
});
