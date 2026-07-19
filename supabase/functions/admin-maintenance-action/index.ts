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
    const { actionType, stationId, slotNum, eventPushUrl, language } = await req.json();

    // Real backend health probe (no secrets exposed, only booleans).
    if (actionType === "health_check") {
      const stripe = Boolean(Deno.env.get("STRIPE_SECRET_KEY"));
      const webhookSecret = Boolean(Deno.env.get("STRIPE_WEBHOOK_SECRET"));
      const chargenow = isChargeNowConfigured();
      // Webhook is "live" only if the secret is set AND at least one verified
      // Stripe webhook event has been processed.
      const { count: webhookEvents } = await db
        .from("webhook_events").select("id", { count: "exact", head: true });
      const webhook = webhookSecret && (webhookEvents ?? 0) > 0;
      return new Response(JSON.stringify({
        ok: true,
        health: { stripe, webhook, webhookSecret, chargenow, webhookEvents: webhookEvents ?? 0 },
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Default kiosk language — admin-gated + audited (no longer a direct client write).
    if (actionType === "set_default_language") {
      const lang = String(language ?? "").toLowerCase();
      if (!["fr", "en", "de"].includes(lang)) {
        return new Response(JSON.stringify({ ok: false, error: "INVALID_LANGUAGE" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      await db.from("kiosk_settings").update({ value: { value: lang } }).eq("key", "default_language");
      await logApi(db, { service: "admin", endpoint: "set_default_language", method: "POST", status_code: 200, request: { lang, by: adminId } });
      return new Response(JSON.stringify({ ok: true, language: lang }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }


    if (!isChargeNowConfigured() && actionType !== "test_auth") {
      return new Response(JSON.stringify({ ok: false, error: "CHARGENOW_NOT_CONFIGURED" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const stationActions = new Set(["test_auth", "sync_status", "eject_by_repair", "operation_pop"]);
    if (stationActions.has(actionType) && (typeof stationId !== "string" || !/^[A-Za-z0-9_-]{4,64}$/.test(stationId))) {
      return new Response(JSON.stringify({ ok: false, error: "VALID_STATION_REQUIRED" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (["eject_by_repair", "operation_pop"].includes(actionType)
      && (!Number.isInteger(Number(slotNum)) || Number(slotNum) < 1 || Number(slotNum) > 128)) {
      return new Response(JSON.stringify({ ok: false, error: "VALID_SLOT_REQUIRED" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (actionType === "config_event_push") {
      try {
        const parsed = new URL(String(eventPushUrl ?? ""));
        if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("invalid");
      } catch {
        return new Response(JSON.stringify({ ok: false, error: "VALID_HTTPS_EVENT_PUSH_URL_REQUIRED" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    let result;
    switch (actionType) {
      case "test_auth":
        // Non-destructive credential check.
        result = await cabinetQuery(stationId);
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
