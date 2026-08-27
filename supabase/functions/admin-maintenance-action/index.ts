import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BASE_URL = (Deno.env.get("CHARGENOW_API_BASE_URL") ?? "https://developer.chargenow.top/cdb-open-api/v1").replace(/\/$/, "");
const BASIC_USER = Deno.env.get("CHARGENOW_BASIC_USERNAME") ?? "";
const BASIC_PASS = Deno.env.get("CHARGENOW_BASIC_PASSWORD") ?? "";
const BASIC_AUTH = Deno.env.get("CHARGENOW_BASIC_AUTH") ?? "";
const MODE = (Deno.env.get("CHARGENOW_MODE") ?? "test").trim().toLowerCase();
const timeoutCandidate = Number(Deno.env.get("CHARGENOW_TIMEOUT_MS") ?? "10000");
const TIMEOUT_MS = Number.isInteger(timeoutCandidate) && timeoutCandidate >= 1000 && timeoutCandidate <= 30000 ? timeoutCandidate : 10000;
const PERMIT_TTL_MS = 5 * 60 * 1000;
const STATION_RE = /^[A-Za-z0-9_-]{4,64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TERMINAL_RENTAL_STATES = [
  "completed", "expired", "payment_cancelled", "payment_expired",
  "payment_failed", "refunded", "cancelled", "failed",
];

type ProviderResult = { ok: boolean; status: number; data: unknown; error: string | null };
type SlotSnapshot = { station_id: string; slot_num: number; status: string | null; battery_id: string | null; updated_at: string | null };

function adminClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function requireRoles(req: Request, db: SupabaseClient, allowedRoles: readonly string[]): Promise<string | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  const jwt = authHeader.replace("Bearer ", "");
  const { data: { user }, error } = await db.auth.getUser(jwt);
  if (error || !user) return null;
  const { data: roles } = await db.from("user_roles").select("role").eq("user_id", user.id);
  return (roles ?? []).some((row: { role: string }) => allowedRoles.includes(row.role)) ? user.id : null;
}

const requireAdmin = (req: Request, db: SupabaseClient) => requireRoles(req, db, ["super_admin", "admin", "operations_admin"]);
const requireSuperAdmin = (req: Request, db: SupabaseClient) => requireRoles(req, db, ["super_admin"]);

function redact(value: unknown): unknown {
  if (!value || typeof value !== "object") return value ?? null;
  const clone = JSON.parse(JSON.stringify(value));
  const keys = ["password", "secret", "authorization", "apikey", "api_key", "token"];
  const walk = (obj: Record<string, unknown>) => {
    for (const key of Object.keys(obj)) {
      if (keys.some((needle) => key.toLowerCase().includes(needle))) obj[key] = "***";
      else if (obj[key] && typeof obj[key] === "object") walk(obj[key] as Record<string, unknown>);
    }
  };
  walk(clone as Record<string, unknown>);
  return clone;
}

async function logApi(db: SupabaseClient, entry: { service: string; endpoint: string; method: string; status_code?: number; request?: unknown; response?: unknown; error?: string | null }) {
  try {
    await db.from("api_logs").insert({
      service: entry.service,
      endpoint: entry.endpoint,
      method: entry.method,
      status_code: entry.status_code ?? null,
      request: redact(entry.request),
      response: redact(entry.response),
      error: entry.error ?? null,
    });
  } catch (_) { /* logging must never block maintenance */ }
}

function chargeNowConfigured() { return Boolean(BASIC_AUTH || (BASIC_USER && BASIC_PASS)); }
function authHeader() {
  if (BASIC_AUTH) return "Basic " + BASIC_AUTH.replace(/^Basic\s+/i, "").trim();
  return "Basic " + btoa(`${BASIC_USER}:${BASIC_PASS}`);
}

function stripeRuntimeOk() {
  const mode = (Deno.env.get("STRIPE_MODE") ?? "").trim().toLowerCase();
  const liveEnabled = (Deno.env.get("STRIPE_LIVE_ENABLED") ?? "").trim().toLowerCase();
  const key = (Deno.env.get("STRIPE_SECRET_KEY") ?? "").trim();
  const webhook = (Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "").trim();
  return mode === "test" && liveEnabled === "false" && (key.startsWith("sk_test_") || key.startsWith("rk_test_")) && webhook.startsWith("whsec_");
}

async function providerRequest(method: "GET" | "POST", path: string, query: Record<string, string | number> = {}): Promise<ProviderResult> {
  if (!chargeNowConfigured()) return { ok: false, status: 0, data: null, error: "CHARGENOW_NOT_CONFIGURED" };
  const url = new URL(BASE_URL + path);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
  try {
    const response = await fetch(url.toString(), {
      method,
      headers: { Accept: "application/json", Authorization: authHeader() },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await response.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    const providerCode = (data as { code?: number } | null)?.code;
    const businessOk = providerCode === undefined ? response.ok : providerCode === 0;
    return {
      ok: response.ok && businessOk,
      status: response.status,
      data,
      error: response.ok && businessOk ? null : `HTTP_${response.status}${providerCode !== undefined ? `_CODE_${providerCode}` : ""}`,
    };
  } catch (error) {
    return { ok: false, status: 0, data: null, error: String(error) };
  }
}

function validStation(value: unknown): value is string { return typeof value === "string" && STATION_RE.test(value); }
function validSlot(value: unknown): number | null {
  const slot = Number(value);
  return Number.isInteger(slot) && slot >= 1 && slot <= 128 ? slot : null;
}
function confirmationFor(stationId: string, slotNum: number) { return `EXECUTER C2 ${stationId.toUpperCase()} SLOT ${slotNum}`; }

async function loadSlot(db: SupabaseClient, stationId: string, slotNum: number): Promise<SlotSnapshot | null> {
  const { data, error } = await db.from("station_slots")
    .select("station_id,slot_num,status,battery_id,updated_at")
    .eq("station_id", stationId)
    .eq("slot_num", slotNum)
    .maybeSingle();
  if (error) throw error;
  return data as SlotSnapshot | null;
}

async function stationIsOnline(db: SupabaseClient, stationId: string): Promise<boolean> {
  const { data, error } = await db.from("stations")
    .select("online")
    .eq("station_id", stationId)
    .maybeSingle();
  if (error) throw error;
  return data?.online === true;
}

async function hasActiveRental(db: SupabaseClient, batteryId: string): Promise<boolean> {
  const { count, error } = await db.from("rental_sessions")
    .select("id", { count: "exact", head: true })
    .eq("battery_id", batteryId)
    .not("state", "in", `(${TERMINAL_RENTAL_STATES.join(",")})`);
  if (error) throw error;
  return (count ?? 0) > 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const db = adminClient();
  const adminId = await requireAdmin(req, db);
  if (!adminId) return json({ ok: false, error: "FORBIDDEN" }, 403);

  try {
    const body = await req.json().catch(() => ({}));
    const actionType = String(body.actionType ?? "");

    if (actionType === "health_check") {
      const stripe = stripeRuntimeOk();
      const { count: webhookEvents } = await db.from("webhook_events").select("id", { count: "exact", head: true });
      return json({
        ok: true,
        health: {
          stripe,
          webhook: stripe && (webhookEvents ?? 0) > 0,
          webhookSecret: stripe,
          chargenow: chargeNowConfigured(),
          webhookEvents: webhookEvents ?? 0,
          chargenowMode: MODE === "live" ? "live" : "test",
        },
      });
    }

    if (actionType === "set_default_language") {
      const lang = String(body.language ?? "").toLowerCase();
      if (!["fr", "en", "de"].includes(lang)) return json({ ok: false, error: "INVALID_LANGUAGE" }, 400);
      await db.from("kiosk_settings").update({ value: { value: lang } }).eq("key", "default_language");
      await logApi(db, { service: "admin", endpoint: "set_default_language", method: "POST", status_code: 200, request: { lang, by: adminId } });
      return json({ ok: true, language: lang });
    }

    if (!chargeNowConfigured()) return json({ ok: false, error: "CHARGENOW_NOT_CONFIGURED" }, 200);

    if (["operation_pop", "config_event_push", "eject_by_repair"].includes(actionType)) {
      return json({ ok: false, error: actionType === "eject_by_repair" ? "ONE_TIME_PERMIT_REQUIRED" : "PHYSICAL_MUTATION_NOT_PERMITTED" }, 409);
    }

    if (["test_auth", "sync_status"].includes(actionType)) {
      if (!validStation(body.stationId)) return json({ ok: false, error: "VALID_STATION_REQUIRED" }, 400);
      const result = await providerRequest("GET", "/rent/cabinet/query", { deviceId: body.stationId });
      await logApi(db, {
        service: "chargenow",
        endpoint: `maintenance:${actionType}`,
        method: "GET",
        status_code: result.status,
        request: { stationId: body.stationId },
        response: result.data,
        error: result.error,
      });
      return json({ ok: result.ok, result: result.data, error: result.error });
    }

    if (actionType === "prepare_eject_by_repair") {
      const superAdminId = await requireSuperAdmin(req, db);
      if (!superAdminId) return json({ ok: false, error: "FORBIDDEN_SUPER_ADMIN_REQUIRED" }, 403);
      if (MODE !== "test") return json({ ok: false, error: "MAINTENANCE_EJECTION_TEST_MODE_REQUIRED" }, 409);
      if (!validStation(body.stationId)) return json({ ok: false, error: "VALID_STATION_REQUIRED" }, 400);
      const slotNum = validSlot(body.slotNum);
      if (slotNum === null) return json({ ok: false, error: "VALID_SLOT_REQUIRED" }, 400);

      if (!await stationIsOnline(db, body.stationId)) return json({ ok: false, error: "STATION_NOT_ONLINE" }, 409);

      const slot = await loadSlot(db, body.stationId, slotNum);
      if (!slot) return json({ ok: false, error: "SLOT_NOT_FOUND" }, 404);
      if (!slot.battery_id) return json({ ok: false, error: "SLOT_EMPTY" }, 409);
      if (await hasActiveRental(db, slot.battery_id)) return json({ ok: false, error: "MAINTENANCE_ACTIVE_RENTAL_EXISTS" }, 409);

      const nowIso = new Date().toISOString();
      await db.from("maintenance_ejection_permits")
        .update({ cancelled_at: nowIso })
        .eq("station_id", body.stationId)
        .eq("slot_num", slotNum)
        .is("consumed_at", null)
        .is("cancelled_at", null)
        .gt("expires_at", nowIso);

      const expiresAt = new Date(Date.now() + PERMIT_TTL_MS).toISOString();
      const { data: permit, error: permitError } = await db.from("maintenance_ejection_permits")
        .insert({ station_id: body.stationId, slot_num: slotNum, expected_battery_id: slot.battery_id, created_by: superAdminId, expires_at: expiresAt })
        .select("id,station_id,slot_num,expected_battery_id,created_at,expires_at")
        .single();
      if (permitError) throw permitError;

      const confirmation = confirmationFor(body.stationId, slotNum);
      await logApi(db, {
        service: "chargenow",
        endpoint: "maintenance:prepare_eject_by_repair",
        method: "POST",
        status_code: 200,
        request: { stationId: body.stationId, slotNum, batteryId: slot.battery_id, permitId: permit.id },
      });

      return json({ ok: true, permitId: permit.id, stationId: body.stationId, slotNum, batteryId: slot.battery_id, slotUpdatedAt: slot.updated_at, expiresAt, confirmation });
    }

    if (actionType === "execute_eject_by_repair") {
      const superAdminId = await requireSuperAdmin(req, db);
      if (!superAdminId) return json({ ok: false, error: "FORBIDDEN_SUPER_ADMIN_REQUIRED" }, 403);
      if (MODE !== "test") return json({ ok: false, error: "MAINTENANCE_EJECTION_TEST_MODE_REQUIRED" }, 409);
      const permitId = String(body.permitId ?? "");
      if (!UUID_RE.test(permitId)) return json({ ok: false, error: "VALID_PERMIT_REQUIRED" }, 400);

      const { data: permit, error: permitError } = await db.from("maintenance_ejection_permits")
        .select("id,station_id,slot_num,expected_battery_id,expires_at,consumed_at,cancelled_at")
        .eq("id", permitId)
        .maybeSingle();
      if (permitError) throw permitError;
      if (!permit) return json({ ok: false, error: "MAINTENANCE_PERMIT_NOT_FOUND" }, 404);
      if (permit.consumed_at || permit.cancelled_at || Date.parse(permit.expires_at) <= Date.now()) {
        return json({ ok: false, error: "MAINTENANCE_PERMIT_EXPIRED_OR_USED" }, 409);
      }

      const expectedConfirmation = confirmationFor(permit.station_id, permit.slot_num);
      const confirmation = String(body.confirmation ?? "").trim().toUpperCase();
      if (confirmation !== expectedConfirmation) return json({ ok: false, error: "CONFIRMATION_REQUIRED", expectedConfirmation }, 409);

      if (!await stationIsOnline(db, permit.station_id)) return json({ ok: false, error: "STATION_NOT_ONLINE" }, 409);

      const slot = await loadSlot(db, permit.station_id, permit.slot_num);
      if (!slot || slot.battery_id !== permit.expected_battery_id) {
        return json({ ok: false, error: "BATTERY_CHANGED_SINCE_PERMIT", expectedBatteryId: permit.expected_battery_id, currentBatteryId: slot?.battery_id ?? null }, 409);
      }
      if (await hasActiveRental(db, permit.expected_battery_id)) {
        return json({ ok: false, error: "MAINTENANCE_ACTIVE_RENTAL_EXISTS" }, 409);
      }

      const consumedAt = new Date().toISOString();
      const { data: consumed, error: consumeError } = await db.from("maintenance_ejection_permits")
        .update({ consumed_at: consumedAt, consumed_by: superAdminId })
        .eq("id", permit.id)
        .is("consumed_at", null)
        .is("cancelled_at", null)
        .gt("expires_at", consumedAt)
        .select("id")
        .maybeSingle();
      if (consumeError) throw consumeError;
      if (!consumed) return json({ ok: false, error: "MAINTENANCE_PERMIT_ALREADY_CONSUMED" }, 409);

      const result = await providerRequest("POST", "/cabinet/ejectByRepair", { cabinetid: permit.station_id, slotNum: permit.slot_num });

      await db.from("maintenance_ejection_permits")
        .update({ provider_result: { ok: result.ok, status: result.status, data: result.data, error: result.error } })
        .eq("id", permit.id);
      await logApi(db, {
        service: "chargenow",
        endpoint: "maintenance:execute_eject_by_repair",
        method: "POST",
        status_code: result.status,
        request: { stationId: permit.station_id, slotNum: permit.slot_num, batteryId: permit.expected_battery_id, permitId: permit.id },
        response: result.data,
        error: result.error,
      });
      await db.from("maintenance_actions").insert({
        station_id: permit.station_id,
        action_type: "eject_by_repair",
        params: { slotNum: permit.slot_num, expectedBatteryId: permit.expected_battery_id, oneTimePermitId: permit.id, mode: "manual_maintenance" },
        result: result.data ?? { error: result.error },
        performed_by: superAdminId,
      });

      return json({ ok: result.ok, stationId: permit.station_id, slotNum: permit.slot_num, batteryId: permit.expected_battery_id, permitId: permit.id, result: result.data, error: result.error });
    }

    return json({ ok: false, error: "UNKNOWN_ACTION" }, 400);
  } catch (error) {
    return json({ ok: false, error: String(error) }, 500);
  }
});
