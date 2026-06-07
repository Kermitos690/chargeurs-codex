// admin-maintenance-action — ADMIN ONLY gateway for DANGEROUS operations.
// ⚠️ Every action here can physically affect hardware. Strictly role-gated.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, logApi, requireAdmin } from "../_shared/db.ts";
import {
  ejectByRepair, operationPop, eventPushConfig, cabinetQuery, isChargeNowConfigured,
} from "../_shared/chargenow.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const db = adminClient();

  const adminId = await requireAdmin(req, db);
  if (!adminId) {
    return new Response(JSON.stringify({ ok: false, error: "FORBIDDEN" }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    const { actionType, stationId, slotNum, eventPushUrl } = await req.json();

    if (!isChargeNowConfigured() && actionType !== "test_auth") {
      return new Response(JSON.stringify({ ok: false, error: "CHARGENOW_NOT_CONFIGURED" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let result;
    switch (actionType) {
      case "test_auth":
        // Non-destructive credential check.
        result = await cabinetQuery(stationId ?? "DTA21269");
        break;
      case "sync_status":
        result = await cabinetQuery(stationId);
        break;
      case "config_event_push":
        result = await eventPushConfig(eventPushUrl);
        break;
      case "eject_by_repair": // ⚠️ DANGEROUS
        result = await ejectByRepair(stationId, Number(slotNum));
        break;
      case "operation_pop": // ⚠️ DANGEROUS
        result = await operationPop(stationId, Number(slotNum));
        break;
      default:
        return new Response(JSON.stringify({ ok: false, error: "UNKNOWN_ACTION" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    await logApi(db, {
      service: "chargenow", endpoint: `maintenance:${actionType}`, method: "POST",
      status_code: result.status, request: { stationId, slotNum }, response: result.data, error: result.error,
    });
    await db.from("maintenance_actions").insert({
      station_id: stationId, action_type: actionType,
      params: { slotNum, eventPushUrl }, result: result.data ?? { error: result.error }, performed_by: adminId,
    });

    return new Response(JSON.stringify({ ok: result.ok, result: result.data, error: result.error }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
