// sync-cabinet-status — pulls REAL cabinet/slot/battery state from ChargeNow
// and updates the database. No mock data: if the API is not configured or a
// station is unreachable, the station is marked unknown/offline.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, logApi } from "../_shared/db.ts";
import { cabinetQuery, isChargeNowConfigured } from "../_shared/chargenow.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const db = adminClient();

  try {
    const body = await req.json().catch(() => ({}));
    const stationId: string | undefined = body.stationId;

    if (!isChargeNowConfigured()) {
      return new Response(
        JSON.stringify({ ok: false, configured: false, error: "CHARGENOW_NOT_CONFIGURED" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const query = db.from("stations").select("station_id, cabinet_id");
    const { data: stations } = stationId
      ? await query.eq("station_id", stationId)
      : await query;

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
        results.push({ stationId: st.station_id, ok: false, error: res.error });
        continue;
      }

      // Tolerant parsing of the documented response shape.
      const d = res.data as Record<string, any>;
      const payload = d.data ?? d;
      const cab = payload.cabinet ?? payload;
      const online = cab.online === true || cab.onlineStatus === 1 || cab.status === "online";
      const slots = payload.slots ?? payload.cabinetSlot ?? cab.slots ?? [];
      const batteries = (Array.isArray(slots) ? slots : []).filter(
        (s: any) => s.batteryId || s.sn || s.bid,
      );
      const rentable = cab.rentable ?? cab.busySlots ?? batteries.length;
      const total = cab.slotNum ?? cab.totalSlots ?? (Array.isArray(slots) ? slots.length : 0);

      await db.from("stations").update({
        status: online ? "online" : "offline",
        online,
        signal: cab.signal ?? cab.signalStrength ?? null,
        rentable_count: rentable,
        returnable_count: total - batteries.length,
        total_count: total,
        last_sync_at: new Date().toISOString(),
        raw_data: payload,
      }).eq("station_id", st.station_id);

      // Upsert slots
      if (Array.isArray(slots)) {
        for (const s of slots) {
          const slotNum = s.slotNum ?? s.slot ?? s.slotId;
          if (slotNum == null) continue;
          await db.from("slots").upsert({
            station_id: st.station_id,
            slot_num: Number(slotNum),
            status: s.batteryId || s.sn ? "occupied" : "empty",
            battery_id: s.batteryId ?? s.sn ?? null,
            raw_data: s,
          }, { onConflict: "station_id,slot_num" });

          const bid = s.batteryId ?? s.sn ?? s.bid;
          if (bid) {
            await db.from("batteries").upsert({
              battery_id: bid,
              station_id: st.station_id,
              slot_num: Number(slotNum),
              status: "in_station",
              power_level: s.batteryCapacity ?? s.power ?? s.electricity ?? null,
              raw_data: s,
            }, { onConflict: "battery_id" });
          }
        }
      }

      results.push({ stationId: st.station_id, ok: true, online });
    }

    return new Response(JSON.stringify({ ok: true, configured: true, results }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
