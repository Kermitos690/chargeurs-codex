// cabinet-event-push — receiver for ChargeNow hardware events.
// Stores raw events, classifies severity, updates station state and closes
// rentals on battery return. Public endpoint (called by ChargeNow servers).
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient } from "../_shared/db.ts";

const SEVERITY: Record<string, string> = {
  CABINET_ONLINE: "info",
  CABINET_OFFLINE: "warning",
  CABINET_STATUS: "info",
  BATTERY_IN: "info",
  BATTERY_BORROW_OUT: "info",
  BATTERY_ABNORMAL_WARNING: "error",
  BATTERY_POPUP: "info",
  POS_INFO_STATUS: "info",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const db = adminClient();

  try {
    const payload = await req.json().catch(() => ({}));
    const eventType: string = payload.eventType ?? payload.type ?? payload.event ?? "UNKNOWN";
    const stationId: string | null =
      payload.deviceId ?? payload.cabinetid ?? payload.cabinetId ?? payload.stationId ?? null;

    await db.from("cabinet_events").insert({
      station_id: stationId,
      event_type: eventType,
      severity: SEVERITY[eventType] ?? "info",
      payload,
    });

    if (stationId) {
      if (eventType === "CABINET_ONLINE") {
        await db.from("stations").update({ online: true, status: "online" }).eq("station_id", stationId);
      } else if (eventType === "CABINET_OFFLINE") {
        await db.from("stations").update({ online: false, status: "offline" }).eq("station_id", stationId);
      } else if (eventType === "BATTERY_IN") {
        // Battery returned — close the most recent active rental for this station.
        const { data: active } = await db.from("rental_sessions")
          .select("id").eq("station_id", stationId)
          .in("state", ["active_rental", "battery_taken", "ejected"])
          .order("created_at", { ascending: false }).limit(1);
        if (active && active[0]) {
          await db.from("rental_sessions").update({
            state: "battery_returned", returned_at: new Date().toISOString(),
          }).eq("id", active[0].id);
        }
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
