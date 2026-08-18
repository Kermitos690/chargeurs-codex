import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const STATION_ID = "DTA21269";
const ACTIVE_RUN_STATES = [
  "created",
  "inventory_confirmed",
  "order_created",
  "ejection_requested",
  "ejection_confirmed",
  "battery_taken",
  "needs_reconciliation",
];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors });

function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

async function requireOperationsAdmin(req: Request, db: ReturnType<typeof adminClient>) {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const jwt = auth.slice("Bearer ".length).trim();
  const { data: { user }, error } = await db.auth.getUser(jwt);
  if (error || !user) return null;
  const { data: roles } = await db.from("user_roles").select("role").eq("user_id", user.id);
  const accepted = (roles ?? []).some((row: { role: string }) =>
    ["super_admin", "admin", "operations_admin"].includes(row.role)
  );
  return accepted ? user.id : null;
}

function providerAuthHeader() {
  const ready = (Deno.env.get("CHARGENOW_BASIC_AUTH") ?? "").replace(/^Basic\s+/i, "").trim();
  if (ready) return `Basic ${ready}`;
  const user = Deno.env.get("CHARGENOW_BASIC_USERNAME") ?? "";
  const pass = Deno.env.get("CHARGENOW_BASIC_PASSWORD") ?? "";
  return user && pass ? `Basic ${btoa(`${user}:${pass}`)}` : null;
}

function providerBase() {
  return (Deno.env.get("CHARGENOW_API_BASE_URL") ?? "https://developer.chargenow.top/cdb-open-api/v1").replace(/\/$/, "");
}

async function readProviderStatus() {
  const auth = providerAuthHeader();
  if (!auth) return { configured: false, reachable: false, httpStatus: 0, businessCode: null as string | null, error: "CHARGENOW_NOT_CONFIGURED" };
  try {
    const url = new URL(`${providerBase()}/rent/cabinet/query`);
    url.searchParams.set("deviceId", STATION_ID);
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: auth },
      signal: AbortSignal.timeout(10_000),
    });
    const text = await res.text();
    let parsed: unknown = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
    const businessCode = parsed && typeof parsed === "object" && !Array.isArray(parsed) && "code" in parsed
      ? String((parsed as Record<string, unknown>).code ?? "")
      : null;
    const businessOk = businessCode === null || businessCode === "0";
    return {
      configured: true,
      reachable: res.ok && businessOk,
      httpStatus: res.status,
      businessCode,
      error: res.ok && businessOk ? null : `HTTP_${res.status}${businessCode ? `_CODE_${businessCode}` : ""}`,
    };
  } catch (error) {
    return { configured: true, reachable: false, httpStatus: 0, businessCode: null, error: String(error instanceof Error ? error.name : "PROVIDER_UNREACHABLE") };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const db = adminClient();
  const actor = await requireOperationsAdmin(req, db);
  if (!actor) return json({ ok: false, error: "FORBIDDEN" }, 403);

  const [stationResult, quarantineResult, slotsResult, devicesResult, runsResult, provider] = await Promise.all([
    db.from("stations")
      .select("station_id,cabinet_id,status,online,rentable_count,returnable_count,total_count,last_sync_at,environment,is_pilot,qualification_mode,qualification_updated_at")
      .eq("station_id", STATION_ID)
      .maybeSingle(),
    db.from("station_hardware_quarantines")
      .select("active,reason_code,details,created_at,updated_at,source_rental_session_id")
      .eq("station_id", STATION_ID)
      .eq("active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db.from("slots")
      .select("slot_num,status,battery_id")
      .eq("station_id", STATION_ID)
      .order("slot_num"),
    db.from("kiosk_devices")
      .select("id,station_id,active,token_revoked,token_expires_at,last_seen_at,app_version,label")
      .eq("station_id", STATION_ID)
      .eq("active", true)
      .order("last_seen_at", { ascending: false })
      .limit(3),
    db.from("hardware_qualification_runs")
      .select("id,state,requested_slot_num,expected_battery_id,observed_slot_num,observed_battery_id,created_at,updated_at")
      .eq("station_id", STATION_ID)
      .in("state", ACTIVE_RUN_STATES)
      .order("created_at", { ascending: false })
      .limit(5),
    readProviderStatus(),
  ]);

  for (const result of [stationResult, quarantineResult, slotsResult, devicesResult, runsResult]) {
    if (result.error) return json({ ok: false, error: "PREFLIGHT_READ_FAILED" }, 500);
  }

  const station = stationResult.data;
  const quarantine = quarantineResult.data;
  const slots = slotsResult.data ?? [];
  const devices = devicesResult.data ?? [];
  const activeRuns = runsResult.data ?? [];

  const providerMode = (Deno.env.get("CHARGENOW_MODE") ?? "test").trim().toLowerCase() === "live" ? "live" : "test";
  const guards = {
    freePayEnvironmentEnabled: Deno.env.get("DTA21269_FREEPAY_ENABLED") === "true",
    providerMutationsEnabled: Deno.env.get("CHARGENOW_MUTATIONS_ENABLED") === "true",
    hardwareEjectionEnabled: Deno.env.get("HARDWARE_EJECTION_ENABLED") === "true",
    providerMode,
  };

  const blockers: string[] = [];
  if (!station) blockers.push("PILOT_STATION_NOT_FOUND");
  if (station && (!station.is_pilot || station.environment === "production")) blockers.push("PILOT_STATION_GUARD_REJECTED");
  if (station && station.online !== true) blockers.push("PILOT_STATION_NOT_ONLINE");
  if (station && station.qualification_mode !== "freepay_test") blockers.push("FREEPAY_MODE_NOT_ACTIVE");
  if (!provider.configured) blockers.push("CHARGENOW_NOT_CONFIGURED");
  else if (!provider.reachable) blockers.push("CHARGENOW_READONLY_STATUS_UNAVAILABLE");
  if (guards.providerMode !== "test") blockers.push("CHARGENOW_TEST_MODE_REQUIRED");
  if (!guards.freePayEnvironmentEnabled) blockers.push("FREEPAY_ENVIRONMENT_GATE_DISABLED");
  if (!guards.providerMutationsEnabled) blockers.push("CHARGENOW_MUTATIONS_DISABLED");
  if (!guards.hardwareEjectionEnabled) blockers.push("HARDWARE_EJECTION_DISABLED");
  if (activeRuns.length > 0) blockers.push("QUALIFICATION_RUN_ALREADY_ACTIVE");
  if (slots.length !== 4) blockers.push("FOUR_SLOT_INVENTORY_NOT_CONFIRMED");
  if (slots.length === 4 && slots.some((slot) => slot.status !== "occupied" || !slot.battery_id)) blockers.push("FULL_BATTERY_IDENTITY_NOT_CONFIRMED");
  if (devices.length === 0) blockers.push("KIOSK_DEVICE_NOT_ACTIVE");

  return json({
    ok: true,
    stationId: STATION_ID,
    mode: "READ_ONLY_PREFLIGHT",
    performedProviderMutation: false,
    performedHardwareAction: false,
    performedPaymentAction: false,
    paired: devices.length > 0,
    station: station ?? null,
    activeDevice: devices[0] ?? null,
    quarantine: quarantine ?? null,
    slots,
    provider,
    guards,
    activeRuns,
    readyForExplicitOperatorQualification: blockers.length === 0,
    blockers,
    nextAction: blockers.length === 0
      ? "EXPLICIT_OPERATOR_APPROVAL_REQUIRED_BEFORE_START_FREEPAY"
      : "RESOLVE_PREFLIGHT_BLOCKERS_WITHOUT_CLEARING_QUARANTINE",
  });
});
