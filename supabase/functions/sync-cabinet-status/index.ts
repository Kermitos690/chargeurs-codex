// sync-cabinet-status — admin-gated synchronization of real ChargeNow state.
// Parsing and persistence are centralized in _shared/stationSync.ts so the
// back-office and Platform API cannot drift into different inventory logic.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, requireAdmin } from "../_shared/db.ts";
import { isChargeNowConfigured } from "../_shared/chargenow.ts";
import { syncStationFromChargeNow } from "../_shared/stationSync.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const db = adminClient();

  const adminId = await requireAdmin(req, db);
  if (!adminId) {
    return new Response(JSON.stringify({ ok: false, error: "FORBIDDEN" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const stationId = typeof body.stationId === "string" ? body.stationId.trim() : "";

    if (!isChargeNowConfigured()) {
      return new Response(JSON.stringify({
        ok: false,
        configured: false,
        error: "CHARGENOW_NOT_CONFIGURED",
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let query = db.from("stations").select("station_id,cabinet_id").order("station_id");
    if (stationId) query = query.eq("station_id", stationId);
    const { data: stations, error } = await query;
    if (error) throw error;

    const results = [];
    for (const station of stations ?? []) {
      results.push(await syncStationFromChargeNow(db, station));
    }

    return new Response(JSON.stringify({ ok: true, configured: true, results }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
