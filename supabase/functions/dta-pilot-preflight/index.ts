import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { hasVerifiedSingleSlotRentalContract } from "../_shared/chargenow.ts";

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

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

const db = () => createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

async function requireAdmin(req: Request, client: ReturnType<typeof db>) {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const { data: { user }, error } = await client.auth.getUser(auth.slice(7).trim());
  if (error || !user) return null;
  const { data: roles } = await client.from("user_roles").select("role").eq("user_id", user.id);
  return (roles ?? []).some((row: { role: string }) =>
    ["super_admin", "admin", "operations_admin"].includes(row.role)
  ) ? user.id : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const client = db();
  if (!await requireAdmin(req, client)) return json({ ok: false, error: "FORBIDDEN" }, 403);

  const [stationQ, quarantineQ, slotsQ, deviceQ, runsQ] = await Promise.all([
    client.from("stations")
      .select("station_id,cabinet_id,status,online,rentable_count,returnable_count,total_count,last_sync_at,environment,is_pilot,qualification_mode,qualification_updated_at")
      .eq("station_id", STATION_ID)
      .maybeSingle(),
    client.from("station_hardware_quarantines")
      .select("active,reason_code,details,created_at,updated_at,source_rental_session_id")
      .eq("station_id", STATION_ID)
      .eq("active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    client.from("slots")
      .select("slot_num,status,battery_id")
      .eq("station_id", STATION_ID)
      .order("slot_num"),
    client.from("kiosk_devices")
      .select("id,station_id,active,token_revoked,token_expires_at,last_seen_at,app_version,label")
      .eq("station_id", STATION_ID)
      .eq("active", true)
      .order("last_seen_at", { ascending: false })
      .limit(1),
    client.from("hardware_qualification_runs")
      .select("id,state,requested_slot_num,expected_battery_id,observed_slot_num,observed_battery_id,created_at,updated_at")
      .eq("station_id", STATION_ID)
      .in("state", ACTIVE_RUN_STATES)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  if (stationQ.error || quarantineQ.error || slotsQ.error || deviceQ.error || runsQ.error) {
    return json({ ok: false, error: "PREFLIGHT_READ_FAILED" }, 500);
  }

  const station = stationQ.data;
  const quarantine = quarantineQ.data;
  const slots = slotsQ.data ?? [];
  const devices = deviceQ.data ?? [];
  const runs = runsQ.data ?? [];

  const guards = {
    providerMode: (Deno.env.get("CHARGENOW_MODE") ?? "test").trim().toLowerCase() === "live" ? "live" : "test",
    freePayEnvironmentEnabled: Deno.env.get("DTA21269_FREEPAY_ENABLED") === "true",
    providerMutationsEnabled: Deno.env.get("CHARGENOW_MUTATIONS_ENABLED") === "true",
    hardwareEjectionEnabled: Deno.env.get("HARDWARE_EJECTION_ENABLED") === "true",
    supplierSingleSlotContractVerified: hasVerifiedSingleSlotRentalContract(),
  };

  const blockers: string[] = [];
  if (!station) blockers.push("PILOT_STATION_NOT_FOUND");
  if (station && (!station.is_pilot || station.environment === "production")) blockers.push("PILOT_STATION_GUARD_REJECTED");
  if (station?.online !== true) blockers.push("PILOT_STATION_NOT_ONLINE");
  if (station?.qualification_mode !== "freepay_test") blockers.push("FREEPAY_MODE_NOT_ACTIVE");
  if (guards.providerMode !== "test") blockers.push("CHARGENOW_TEST_MODE_REQUIRED");
  if (!guards.freePayEnvironmentEnabled) blockers.push("FREEPAY_ENVIRONMENT_GATE_DISABLED");
  if (!guards.providerMutationsEnabled) blockers.push("CHARGENOW_MUTATIONS_DISABLED");
  if (!guards.hardwareEjectionEnabled) blockers.push("HARDWARE_EJECTION_DISABLED");
  if (!guards.supplierSingleSlotContractVerified) blockers.push("SUPPLIER_SINGLE_SLOT_RENTAL_CONTRACT_UNVERIFIED");
  if (runs.length) blockers.push("QUALIFICATION_RUN_ALREADY_ACTIVE");
  if (slots.length !== 4) blockers.push("FOUR_SLOT_INVENTORY_NOT_CONFIRMED");
  if (slots.length === 4 && slots.some((slot) => slot.status !== "occupied" || !slot.battery_id)) {
    blockers.push("FULL_BATTERY_IDENTITY_NOT_CONFIRMED");
  }
  if (!devices.length) blockers.push("KIOSK_DEVICE_NOT_ACTIVE");

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
    guards,
    activeRuns: runs,
    readyForExplicitOperatorQualification: blockers.length === 0,
    blockers,
    nextAction: blockers.length === 0
      ? "EXPLICIT_OPERATOR_APPROVAL_REQUIRED_BEFORE_START_FREEPAY"
      : "RESOLVE_PREFLIGHT_BLOCKERS_WITHOUT_CLEARING_QUARANTINE",
  });
});
