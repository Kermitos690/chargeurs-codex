// admin-maintenance-action — ADMIN ONLY gateway for DANGEROUS operations.
// ⚠️ Every action here can physically affect hardware. Strictly role-gated.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, logApi, requireAdmin } from "../_shared/db.ts";
import {
  ejectByRepairWithOneTimePermit, oneTimeMaintenanceEjectionPermit, operationPop, eventPushConfig, cabinetQuery, isChargeNowConfigured,
  type OneTimeMaintenanceEjectionPermit,
} from "../_shared/chargenow.ts";
import { validateStripeTestRuntime } from "../_shared/stripeRuntimeConfig.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const db = adminClient();

  const adminId = await requireAdmin(req, db);
  if (!adminId) {
    return new Response(JSON.stringify({ ok: false, error: "FORBIDDEN" }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    const { actionType, stationId, slotNum, eventPushUrl, language, batteryId, permitId } = await req.json();

    // Real backend health probe (no secrets exposed, only booleans).
    if (actionType === "health_check") {
      const stripeRuntime = validateStripeTestRuntime({ requireWebhookSecret: true });
      const stripe = stripeRuntime.ok;
      const webhookSecret = stripeRuntime.ok;
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

    const stationActions = new Set(["test_auth", "sync_status", "prepare_eject_by_repair", "eject_by_repair", "operation_pop"]);
    if (stationActions.has(actionType) && (typeof stationId !== "string" || !/^[A-Za-z0-9_-]{4,64}$/.test(stationId))) {
      return new Response(JSON.stringify({ ok: false, error: "VALID_STATION_REQUIRED" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (["prepare_eject_by_repair", "eject_by_repair", "operation_pop"].includes(actionType)
      && (!Number.isInteger(Number(slotNum)) || Number(slotNum) < 1 || Number(slotNum) > 128)) {
      return new Response(JSON.stringify({ ok: false, error: "VALID_SLOT_REQUIRED" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // A physical repair ejection is never unlocked by the broad provider flag
    // alone. It needs an exact, short-lived server-side permit. No client can
    // select a different cabinet, slot or detected battery, and the permit is
    // consumed before one recorded attempt (including an ambiguous timeout).
    let oneTimePermit: OneTimeMaintenanceEjectionPermit | null = null;
    const normalizedBatteryId = typeof batteryId === "string" ? batteryId.trim().toUpperCase() : "";

    const detectedBatteryInSlot = (providerPayload: unknown, expectedSlot: number): string | null => {
      const root = providerPayload && typeof providerPayload === "object" ? providerPayload as Record<string, unknown> : {};
      const nested = root.data && typeof root.data === "object" ? root.data as Record<string, unknown> : root;
      const batteries = nested.batteries;
      if (!Array.isArray(batteries)) return null;
      const entry = batteries.find((candidate) => {
        const item = candidate && typeof candidate === "object" ? candidate as Record<string, unknown> : {};
        return Number(item.slotNum ?? item.slot_num) === expectedSlot;
      });
      if (!entry || typeof entry !== "object") return null;
      const id = (entry as Record<string, unknown>).batteryId ?? (entry as Record<string, unknown>).battery_id;
      return typeof id === "string" && id.trim() ? id.trim().toUpperCase() : null;
    };

    if (actionType === "prepare_eject_by_repair") {
      if (!/^[A-Z0-9_-]{6,64}$/.test(normalizedBatteryId)) {
        return new Response(JSON.stringify({ ok: false, error: "VALID_BATTERY_ID_REQUIRED" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const current = await cabinetQuery(stationId);
      const detectedBatteryId = current.ok ? detectedBatteryInSlot(current.data, Number(slotNum)) : null;
      if (!detectedBatteryId || detectedBatteryId !== normalizedBatteryId) {
        await logApi(db, {
          service: "chargenow", endpoint: "maintenance:prepare_eject_by_repair", method: "POST", status_code: current.status,
          request: { stationId, slotNum, claimedBatteryId: normalizedBatteryId }, response: current.data,
          error: current.error ?? "BATTERY_SLOT_MISMATCH",
        });
        return new Response(JSON.stringify({ ok: false, error: "BATTERY_SLOT_MISMATCH", detectedBatteryId }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const prepared: OneTimeMaintenanceEjectionPermit = {
        id: crypto.randomUUID(), stationId, slotNum: Number(slotNum),
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      };
      const { error: insertError } = await db.from("maintenance_actions").insert({
        station_id: stationId,
        action_type: "pending_one_time_maintenance_ejection",
        params: { oneTimePermitId: prepared.id, stationId, slotNum: prepared.slotNum, batteryId: normalizedBatteryId, expiresAt: prepared.expiresAt },
        result: { state: "prepared_after_provider_slot_check" },
        performed_by: adminId,
      });
      if (insertError) throw insertError;
      await logApi(db, {
        service: "chargenow", endpoint: "maintenance:prepare_eject_by_repair", method: "POST", status_code: current.status,
        request: { stationId, slotNum, batteryId: normalizedBatteryId, permitId: prepared.id },
        response: { state: "prepared", expiresAt: prepared.expiresAt },
      });
      return new Response(JSON.stringify({ ok: true, permitId: prepared.id, batteryId: normalizedBatteryId, expiresAt: prepared.expiresAt }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (actionType === "eject_by_repair") {
      const requestedPermitId = typeof permitId === "string" ? permitId.trim() : "";
      const { data: permitRow, error: permitError } = await db.from("maintenance_actions")
        .select("id,params,performed_by")
        .eq("id", requestedPermitId)
        .eq("action_type", "pending_one_time_maintenance_ejection")
        .eq("performed_by", adminId)
        .maybeSingle();
      if (permitError) throw permitError;
      const permitParams = permitRow?.params && typeof permitRow.params === "object" ? permitRow.params as Record<string, unknown> : {};
      const permit: OneTimeMaintenanceEjectionPermit | null = permitRow
        && typeof permitParams.oneTimePermitId === "string"
        && permitParams.oneTimePermitId === requestedPermitId
        && typeof permitParams.stationId === "string"
        && Number.isInteger(Number(permitParams.slotNum))
        && typeof permitParams.expiresAt === "string"
        ? { id: requestedPermitId, stationId: permitParams.stationId, slotNum: Number(permitParams.slotNum), expiresAt: permitParams.expiresAt }
        : null;
      const permitMatches = permit && permit.stationId === stationId && permit.slotNum === Number(slotNum)
        && Date.parse(permit.expiresAt) > Date.now();
      if (!permitMatches) {
        return new Response(JSON.stringify({ ok: false, error: "ONE_TIME_MAINTENANCE_EJECTION_NOT_PERMITTED" }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      oneTimePermit = permit;
      const { count, error: priorAttemptError } = await db.from("maintenance_actions")
        .select("id", { count: "exact", head: true })
        .eq("action_type", "one_time_maintenance_ejection_attempt")
        .contains("params", { oneTimePermitId: permit.id });
      if (priorAttemptError) throw priorAttemptError;
      if ((count ?? 0) > 0) {
        return new Response(JSON.stringify({ ok: false, error: "ONE_TIME_MAINTENANCE_EJECTION_ALREADY_ATTEMPTED" }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const current = await cabinetQuery(stationId);
      const expectedBatteryId = typeof permitParams.batteryId === "string" ? permitParams.batteryId : "";
      const detectedBatteryId = current.ok ? detectedBatteryInSlot(current.data, Number(slotNum)) : null;
      if (!detectedBatteryId || detectedBatteryId !== expectedBatteryId) {
        await logApi(db, {
          service: "chargenow", endpoint: "maintenance:eject_by_repair", method: "POST", status_code: current.status,
          request: { stationId, slotNum, permitId: permit.id, expectedBatteryId }, response: current.data,
          error: current.error ?? "BATTERY_SLOT_MISMATCH",
        });
        return new Response(JSON.stringify({ ok: false, error: "BATTERY_SLOT_MISMATCH", detectedBatteryId }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const { error: attemptError } = await db.from("maintenance_actions").insert({
        station_id: stationId, action_type: "one_time_maintenance_ejection_attempt",
        params: { oneTimePermitId: permit.id, slotNum: Number(slotNum), batteryId: expectedBatteryId, expiresAt: permit.expiresAt },
        result: { state: "provider_request_started" }, performed_by: adminId,
      });
      if (attemptError) throw attemptError;
    }
    if (["operation_pop", "config_event_push"].includes(actionType)) {
      return new Response(JSON.stringify({ ok: false, error: "PHYSICAL_MUTATION_NOT_PERMITTED" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
        result = await ejectByRepairWithOneTimePermit(stationId, Number(slotNum), oneTimePermit);
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
      params: { slotNum, eventPushUrl, ...(oneTimePermit ? { oneTimePermitId: oneTimePermit.id } : {}) }, result: result.data ?? { error: result.error }, performed_by: adminId,
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
