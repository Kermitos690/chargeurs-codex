// sync-cabinet-status — pulls REAL cabinet/slot/battery state from ChargeNow
// and updates the database. No mock data: if the API is not configured or a
// station is unreachable, the station is marked unknown/offline.
//
// Authorization:
// - admins may synchronize one station or all stations;
// - a provisioned kiosk may synchronize only the station bound to its token.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, logApi, requireAdmin, verifyKioskDevice } from "../_shared/db.ts";
import { cabinetQuery, isChargeNowConfigured } from "../_shared/chargenow.ts";

// Typed (tolerant) view of the documented ChargeNow "Get Device Info" payload.
interface CabinetInfo {
  online?: boolean; onlineStatus?: number; status?: string;
  slots?: number; slotNum?: number; totalSlots?: number; emptySlots?: number;
  signal?: number; signalStrength?: number;
}
interface BatteryInfo {
  slotNum?: number; slot?: number; slotId?: number;
  batteryId?: string; sn?: string; bid?: string;
  vol?: number; batteryCapacity?: number; power?: number; electricity?: number;
}
interface CabinetPayload {
  cabinet?: CabinetInfo; batteries?: BatteryInfo[]; slots?: BatteryInfo[]; data?: CabinetPayload;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const db = adminClient();

  try {
    const body = await req.json().catch(() => ({}));
    const stationId = typeof body.stationId === "string" ? body.stationId.trim() : undefined;

    const adminId = await requireAdmin(req, db);
    if (!adminId) {
      // Kiosks are fail-closed and station-bound. A kiosk can never request the
      // all-stations branch and cannot impersonate another cabinet.
      if (!stationId) return json({ ok: false, error: "KIOSK_STATION_REQUIRED" }, 400);
      const auth = await verifyKioskDevice(req, db, stationId);
      if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
    }

    if (!isChargeNowConfigured()) {
      return json({ ok: false, configured: false, error: "CHARGENOW_NOT_CONFIGURED" });
    }

    const query = db.from("stations").select("station_id, cabinet_id");
    const { data: stations, error: stationError } = stationId
      ? await query.eq("station_id", stationId)
      : await query;

    if (stationError) return json({ ok: false, configured: true, error: "STATION_QUERY_FAILED" }, 500);
    if (stationId && !(stations ?? []).length) {
      return json({ ok: false, configured: true, error: "STATION_NOT_FOUND" }, 404);
    }

    const results: Array<Record<string, unknown>> = [];

    for (const st of stations ?? []) {
      const deviceId = (st.cabinet_id as string) || (st.station_id as string);
      const res = await cabinetQuery(deviceId);
      await logApi(db, {
        service: "chargenow", endpoint: "/rent/cabinet/query", method: "GET",
        status_code: res.status, request: { deviceId }, response: res.data, error: res.error,
      });

      if (!res.ok || !res.data) {
        await db.from("stations").update({
          status: "unknown", online: false, last_sync_at: new Date().toISOString(),
        }).eq("station_id", st.station_id);
        results.push({ stationId: st.station_id, ok: false, error: res.error ?? "CHARGENOW_UNREACHABLE" });
        continue;
      }

      // Tolerant parsing of the documented response shape.
      const d = (res.data ?? {}) as CabinetPayload;
      const payload = (d.data ?? d) as CabinetPayload;
      // Documented response shape (Apifox "1.Get Device Info" — GET /rent/cabinet/query):
      //   data.cabinet  : { online, slots (total), emptySlots, busySlots, signal, qrCode, id, shopId, ... }
      //   data.batteries: [{ slotNum, vol, batteryId }]  (batteries currently present & rentable)
      //   data.priceStrategy / data.shop
      const cab = (payload.cabinet ?? payload) as CabinetInfo;
      const online = cab.online === true || cab.onlineStatus === 1 || cab.status === "online";

      // Batteries available to rent come from data.batteries[].
      const batteries: BatteryInfo[] = Array.isArray(payload.batteries)
        ? payload.batteries
        : (Array.isArray(payload.slots) ? payload.slots : []).filter(
            (s: BatteryInfo) => s.batteryId || s.sn || s.bid,
          );

      // total = number of physical slots; emptySlots = returnable capacity.
      const total = Number(cab.slots ?? cab.slotNum ?? cab.totalSlots ?? 0);
      const rentable = batteries.length;
      const returnable = Number(cab.emptySlots ?? (total ? total - batteries.length : 0));
      const syncedAt = new Date().toISOString();

      await db.from("stations").update({
        status: online ? "online" : "offline",
        online,
        signal: cab.signal ?? cab.signalStrength ?? null,
        rentable_count: rentable,
        returnable_count: returnable,
        total_count: total,
        last_sync_at: syncedAt,
        raw_data: payload,
      }).eq("station_id", st.station_id);

      // Upsert one slot row per battery currently present.
      for (const b of batteries) {
        const slotNum = b.slotNum ?? b.slot ?? b.slotId;
        if (slotNum == null) continue;
        const bid = b.batteryId ?? b.sn ?? b.bid ?? null;
        await db.from("slots").upsert({
          station_id: st.station_id,
          slot_num: Number(slotNum),
          status: bid ? "occupied" : "empty",
          battery_id: bid,
          raw_data: b,
        }, { onConflict: "station_id,slot_num" });

        if (bid) {
          await db.from("batteries").upsert({
            battery_id: bid,
            station_id: st.station_id,
            slot_num: Number(slotNum),
            status: "in_station",
            // "vol" is the documented battery voltage/charge field.
            power_level: b.vol ?? b.batteryCapacity ?? b.power ?? b.electricity ?? null,
            raw_data: b,
          }, { onConflict: "battery_id" });
        }
      }

      results.push({
        stationId: st.station_id,
        ok: true,
        online,
        rentableCount: rentable,
        returnableCount: returnable,
        totalCount: total,
        syncedAt,
      });
    }

    return json({ ok: true, configured: true, results });
  } catch (e) {
    console.error("sync-cabinet-status failed", e instanceof Error ? e.message : "UNKNOWN_ERROR");
    return json({ ok: false, error: "INTERNAL_ERROR" }, 500);
  }
});
