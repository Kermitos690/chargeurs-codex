// kiosk-cabinet-snapshot — station-bound and read-only. Raw supplier fields
// remain server-side; the kiosk only receives safe display values.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, verifyKioskDevice } from "../_shared/db.ts";
import { isChargeNowConfigured } from "../_shared/chargenow.ts";
import { readCabinetSnapshot } from "../_shared/cabinetSnapshot.ts";

const headers = {
  ...corsHeaders,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-kiosk-token",
  "Access-Control-Expose-Headers": "x-correlation-id",
};

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
    const slots = snapshot.slots.map((slot) => ({
      slot_num: slot.slot_num, charge_percent: slot.charge_percent, rentable: slot.rentable,
      confidence: slot.confidence, status: slot.customer_status, recommended: false,
    }));
    const candidates = slots.filter((slot) => slot.rentable && slot.charge_percent != null)
      .sort((a, b) => (b.charge_percent ?? -1) - (a.charge_percent ?? -1) || a.slot_num - b.slot_num);
    if (candidates[0]) candidates[0].recommended = true;
    return json({ ok: true, configured: true, online: snapshot.online, slots, syncedAt: new Date().toISOString() });
  } catch (error) {
    console.error("kiosk-cabinet-snapshot", error instanceof Error ? error.message : "UNKNOWN_ERROR");
    return json({ ok: false, error: "SNAPSHOT_UNAVAILABLE" }, 503);
  }
});
