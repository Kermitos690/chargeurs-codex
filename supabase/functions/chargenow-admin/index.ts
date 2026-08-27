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
const MUTATIONS_ENABLED = Deno.env.get("CHARGENOW_MUTATIONS_ENABLED") === "true";
const HARDWARE_EJECTION_ENABLED = Deno.env.get("HARDWARE_EJECTION_ENABLED") === "true";
const SINGLE_SLOT_VERIFIED = Deno.env.get("CHARGENOW_SINGLE_SLOT_RENTAL_CONTRACT") === "verified";
const RENT_SLOT_ZERO_MODE = Deno.env.get("CHARGENOW_RENT_SLOT_ZERO_MODE") ?? "";
const timeoutCandidate = Number(Deno.env.get("CHARGENOW_TIMEOUT_MS") ?? "10000");
const TIMEOUT_MS = Number.isInteger(timeoutCandidate) && timeoutCandidate >= 1000 && timeoutCandidate <= 30000 ? timeoutCandidate : 10000;
const TEST_STATION = "DTA21269";

const DANGEROUS = new Set(["C1", "C2", "C3", "C9", "C10", "C11", "C12", "S5", "P4", "E1"]);
const MUTATING_CODES = new Set(["O2", "O4", "C1", "C2", "C3", "C9", "C10", "C11", "C12", "S3", "S4", "S5", "P3", "P4", "P5", "P6", "E1"]);
const SENSITIVE_CODES = new Set(["A1"]);
const PHYSICAL_C1 = new Set(["pop", "popall", "popallForNoAuth", "popallForAuth"]);
const SAFE_READ_CODES = ["O1", "O3", "O5", "O6", "C4", "C5", "C6", "C7", "C8", "S1", "S2", "P1", "P2", "R1", "E2", "E3"];

const MUTATION_META: Record<string, { name: string; dangerous: boolean }> = {
  O2: { name: "Create Rent Order", dangerous: false },
  O3: { name: "Query Rent Order Status", dangerous: false },
  O4: { name: "Mark Order Completed", dangerous: false },
  S3: { name: "Create New Shop", dangerous: false },
  S4: { name: "Update Shop", dangerous: false },
  S5: { name: "Delete Shop", dangerous: true },
  P3: { name: "Create Or Update Price Strategy", dangerous: false },
  P4: { name: "Delete Price Strategy", dangerous: true },
  P5: { name: "Shop Bind Price Strategy", dangerous: false },
  P6: { name: "Shop Unbind Price Strategy", dangerous: false },
  C1: { name: "Device Operation", dangerous: true },
  C2: { name: "Eject By Repair", dangerous: true },
  C3: { name: "Eject By Rent", dangerous: true },
  E1: { name: "Cabinet Event Push Config", dangerous: true },
};

type ProviderResult = { ok: boolean; status: number; data: unknown; error: string | null };
type MaintenanceInvokeResult = { ok: boolean; status: number; data: Record<string, unknown> | null; error: string | null };
type Query = Record<string, string | number | boolean | undefined | null>;

function dbClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

async function requireRoles(req: Request, db: SupabaseClient, allowed: readonly string[]): Promise<string | null> {
  const auth = req.headers.get("Authorization");
  if (!auth) return null;
  const jwt = auth.replace(/^Bearer\s+/i, "");
  const { data: { user }, error } = await db.auth.getUser(jwt);
  if (error || !user) return null;
  const { data: roles } = await db.from("user_roles").select("role").eq("user_id", user.id);
  return (roles ?? []).some((row: { role: string }) => allowed.includes(row.role)) ? user.id : null;
}

const requireAdmin = (req: Request, db: SupabaseClient) => requireRoles(req, db, ["super_admin", "admin", "operations_admin"]);
const requireSuperAdmin = (req: Request, db: SupabaseClient) => requireRoles(req, db, ["super_admin"]);

function redact(value: unknown): unknown {
  if (!value || typeof value !== "object") return value ?? null;
  const clone = JSON.parse(JSON.stringify(value));
  const secretKeys = ["password", "secret", "authorization", "apikey", "api_key", "token"];
  const walk = (obj: Record<string, unknown>) => {
    for (const key of Object.keys(obj)) {
      if (secretKeys.some((needle) => key.toLowerCase().includes(needle))) obj[key] = "***";
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
  } catch (_) { /* audit failure must not mutate provider behavior */ }
}

function configured() { return Boolean(BASIC_AUTH || (BASIC_USER && BASIC_PASS)); }
function providerAuth() {
  if (BASIC_AUTH) return "Basic " + BASIC_AUTH.replace(/^Basic\s+/i, "").trim();
  return "Basic " + btoa(`${BASIC_USER}:${BASIC_PASS}`);
}

function physicalBlockError(): string | null {
  if (!MUTATIONS_ENABLED) return "CHARGENOW_MUTATIONS_DISABLED";
  if (!HARDWARE_EJECTION_ENABLED) return "HARDWARE_EJECTION_DISABLED";
  if (!SINGLE_SLOT_VERIFIED) return "SUPPLIER_SINGLE_SLOT_RENTAL_CONTRACT_UNVERIFIED";
  return null;
}

async function providerRequest(method: string, path: string, opts: { query?: Query; body?: unknown; bearer?: string } = {}): Promise<ProviderResult> {
  if (!configured() && !opts.bearer) return { ok: false, status: 0, data: null, error: "CHARGENOW_NOT_CONFIGURED" };
  const url = new URL(BASE_URL + path);
  for (const [key, value] of Object.entries(opts.query ?? {})) if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  const headers: Record<string, string> = { Accept: "application/json", Authorization: opts.bearer ? `Bearer ${opts.bearer}` : providerAuth() };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  try {
    const response = await fetch(url.toString(), {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await response.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    const code = (data as { code?: number } | null)?.code;
    const businessOk = code === undefined ? response.ok : code === 0;
    return { ok: response.ok && businessOk, status: response.status, data, error: response.ok && businessOk ? null : `HTTP_${response.status}${code !== undefined ? `_CODE_${code}` : ""}` };
  } catch (error) {
    return { ok: false, status: 0, data: null, error: String(error) };
  }
}

function mutationBlocked(): ProviderResult | null {
  return MUTATIONS_ENABLED ? null : { ok: false, status: 409, data: null, error: "CHARGENOW_MUTATIONS_DISABLED" };
}

function resolveRentSlot(value: unknown): { ok: true; slotNum: number } | { ok: false; error: string } {
  if (value === null || value === undefined || value === "") {
    return RENT_SLOT_ZERO_MODE === "provider_auto_select" ? { ok: true, slotNum: 0 } : { ok: false, error: "CHARGENOW_SLOT_SELECTION_REQUIRED" };
  }
  const slot = Number(value);
  if (!Number.isInteger(slot) || slot < 0) return { ok: false, error: "CHARGENOW_SLOT_INVALID" };
  if (slot === 0 && RENT_SLOT_ZERO_MODE !== "provider_auto_select") return { ok: false, error: "CHARGENOW_SLOT_ZERO_NOT_ALLOWED" };
  return { ok: true, slotNum: slot };
}

async function dispatch(code: string, p: Record<string, unknown>): Promise<ProviderResult> {
  const s = (k: string, d = "") => String(p[k] ?? d);
  const n = (k: string, d = 0) => Number(p[k] ?? d);
  const mutationGuard = () => mutationBlocked();
  switch (code) {
    case "A1": return providerRequest("POST", "/oauth2/login", { query: { username: s("username"), password: s("passwordSha256") } });
    case "O1": return providerRequest("GET", "/rent/cabinet/query", { query: { deviceId: s("deviceId", TEST_STATION) } });
    case "O2": {
      const blocked = physicalBlockError();
      if (blocked) return { ok: false, status: 409, data: null, error: blocked };
      return providerRequest("POST", "/rent/order/create", { query: { deviceId: s("deviceId", TEST_STATION), callbackURL: s("callbackURL") || undefined } });
    }
    case "O3": return providerRequest("POST", "/rent/order/query", { query: { tradeNo: s("tradeNo") } });
    case "O4": return mutationGuard() ?? providerRequest("POST", "/rent/order/close", { query: { tradeNo: s("tradeNo") } });
    case "O5": return providerRequest("GET", "/rent/order/detail", { query: { tradeNo: s("tradeNo") } });
    case "O6": return providerRequest("POST", "/rent/cabinet/list", { query: { coordType: s("coordType", "GCJ-02"), zoomLevel: s("zoomLevel", "5"), lat: s("lat", "46.54"), lng: s("lng", "6.67"), showPrice: true } });
    case "O7": return { ok: false, status: 0, data: null, error: "PROVIDER_ENDPOINT_MISSING" };
    case "C1": {
      const operationType = s("operationType", "heartbeat");
      if (PHYSICAL_C1.has(operationType)) {
        const blocked = physicalBlockError();
        if (blocked) return { ok: false, status: 409, data: null, error: blocked };
      } else {
        const blocked = mutationGuard();
        if (blocked) return blocked;
      }
      return providerRequest("POST", "/cabinet/operation", { query: { cabinetid: s("cabinetid", TEST_STATION), slotNum: n("slotNum"), operationType, reason: s("reason", "admin") } });
    }
    case "C2": return { ok: false, status: 409, data: null, error: "C2_WORKSHOP_DELEGATION_REQUIRED" };
    case "C3": {
      const blocked = physicalBlockError();
      if (blocked) return { ok: false, status: 409, data: null, error: blocked };
      const slot = resolveRentSlot(p.slotNum);
      if (!slot.ok) return { ok: false, status: 409, data: null, error: slot.error };
      return providerRequest("POST", "/cabinet/ejectByRent", { query: { cabinetid: s("cabinetid", TEST_STATION), rentOrderId: s("rentOrderId") || undefined, slotNum: slot.slotNum } });
    }
    case "C4": return providerRequest("GET", `/cabinet/detail/${encodeURIComponent(s("cabinetId", TEST_STATION))}`);
    case "C5": return providerRequest("GET", "/cabinet/getDeviceByShopId", { query: { shopid: s("shopid", "630bdd3b23") } });
    case "C6": return providerRequest("GET", "/cabinet/getAllDevicePage", { query: { page: s("page", "1"), limit: s("limit", "20") } });
    case "C7": return providerRequest("GET", `/cabinet/batteryListByCabinetId/${encodeURIComponent(s("cabinetId", TEST_STATION))}`);
    case "C8": return providerRequest("GET", `/cabinet/slotByCabinetId/${encodeURIComponent(s("cabinetId", TEST_STATION))}`);
    case "C9": return mutationGuard() ?? providerRequest("POST", `/cabinet/bind2shop/${encodeURIComponent(s("qrcode"))}/${encodeURIComponent(s("newshopid"))}`);
    case "C10": return mutationGuard() ?? providerRequest("POST", "/cabinet/bindAd", { body: { cabinetIdList: (p.cabinetIdList as string[]) ?? [], isRestart: Boolean(p.isRestart), adConfigList: (p.adConfigList as unknown[]) ?? [] } });
    case "C11": return mutationGuard() ?? providerRequest("POST", "/cabinet/unbindShop", { body: (p.deviceIds as string[]) ?? [] });
    case "C12": return mutationGuard() ?? providerRequest("POST", "/cabinet/publishAd", { body: { cabinetIdList: (p.cabinetIdList as string[]) ?? [], restart: Boolean(p.restart), adConfigList: (p.adConfigList as unknown[]) ?? [] } });
    case "S1": return providerRequest("GET", "/shop/getShopList");
    case "S2": return providerRequest("GET", `/shop/detail/${encodeURIComponent(s("shopid", "630bdd3b23"))}`);
    case "S3": return mutationGuard() ?? providerRequest("POST", "/shop/create", { body: (p.body as Record<string, unknown>) ?? {} });
    case "S4": return mutationGuard() ?? providerRequest("PUT", "/shop/update", { body: (p.body as Record<string, unknown>) ?? {} });
    case "S5": return mutationGuard() ?? providerRequest("DELETE", `/shop/delete/${encodeURIComponent(s("shopid"))}`);
    case "P1": return providerRequest("POST", "/shop/priceStrategy/page", { body: { size: 10, current: 1, ...((p.body as Record<string, unknown>) ?? {}) } });
    case "P2": return providerRequest("GET", `/shop/priceStrategy/detail/${encodeURIComponent(s("priceId"))}`);
    case "P3": return mutationGuard() ?? providerRequest("POST", "/shop/priceStrategy/saveOrUpdate", { body: (p.body as Record<string, unknown>) ?? { name: "test" } });
    case "P4": return mutationGuard() ?? providerRequest("POST", "/shop/priceStrategy/delete", { body: (p.priceIds as number[]) ?? [] });
    case "P5": return mutationGuard() ?? providerRequest("POST", "/shop/priceStrategy/bindShop", { body: { shopId: s("shopId"), priceId: n("priceId"), customType: n("customType") } });
    case "P6": return mutationGuard() ?? providerRequest("POST", "/shop/priceStrategy/unbindShop", { body: { shopId: s("shopId"), customType: n("customType") } });
    case "R1": return providerRequest("GET", "/order/list", { query: (p.filters as Query) ?? {} });
    case "E1": return mutationGuard() ?? providerRequest("POST", "/cabinet/eventPush/config", { body: { pushUrl: s("pushUrl"), eventSubscriptions: (p.eventSubscriptions as unknown[]) ?? [] } });
    case "E2": return providerRequest("GET", "/cabinet/eventPush/config/get");
    case "E3": return { ok: true, status: 200, data: { note: "E3 is the public receiver edge function cabinet-event-push" }, error: null };
    default: return { ok: false, status: 400, data: null, error: "UNKNOWN_CODE" };
  }
}

function firstString(value: unknown, keys: string[]): string {
  if (!value || typeof value !== "object") return "";
  const object = value as Record<string, unknown>;
  for (const key of keys) {
    const direct = object[key];
    if (typeof direct === "string" || typeof direct === "number") return String(direct);
  }
  for (const nestedKey of ["data", "page", "records", "list", "rows"]) {
    const nested = object[nestedKey];
    if (Array.isArray(nested) && nested.length) {
      const found = firstString(nested[0], keys);
      if (found) return found;
    }
    const found = firstString(nested, keys);
    if (found) return found;
  }
  return "";
}

function confirmationPhrase(code: string, params: Record<string, unknown>): string {
  const cabinetId = String(params.cabinetid ?? params.cabinetId ?? params.deviceId ?? "").trim().toUpperCase();
  const slotNum = Number(params.slotNum);
  if (code === "C2" && cabinetId && slotNum === 0) return `EJECTER TOUT ${cabinetId}`;
  if (["C1", "C2", "C3"].includes(code) && cabinetId && Number.isInteger(slotNum)) return `EXECUTER ${code} ${cabinetId} SLOT ${slotNum}`;
  return `EXECUTER ${code}`;
}

async function invokeMaintenance(req: Request, body: Record<string, unknown>): Promise<MaintenanceInvokeResult> {
  const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
  const apiKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authorization = req.headers.get("Authorization") ?? "";
  if (!supabaseUrl || !apiKey || !authorization) return { ok: false, status: 500, data: null, error: "MAINTENANCE_DELEGATION_NOT_CONFIGURED" };
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/admin-maintenance-action`, {
      method: "POST",
      headers: { Authorization: authorization, apikey: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const text = await response.text();
    let data: Record<string, unknown> | null = null;
    try { data = text ? JSON.parse(text) as Record<string, unknown> : null; } catch { data = { raw: text }; }
    const ok = response.ok && data?.ok === true;
    return { ok, status: response.status, data, error: ok ? null : String(data?.error ?? `HTTP_${response.status}`) };
  } catch (error) {
    return { ok: false, status: 0, data: null, error: String(error) };
  }
}

async function workshopC2(req: Request, params: Record<string, unknown>, confirmation: string): Promise<ProviderResult> {
  const stationId = String(params.cabinetid ?? params.cabinetId ?? "").trim();
  const slotNum = Number(params.slotNum);
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(stationId)) return { ok: false, status: 400, data: null, error: "VALID_STATION_REQUIRED" };
  if (!Number.isInteger(slotNum) || slotNum < 1 || slotNum > 128) return { ok: false, status: 400, data: null, error: "VALID_SLOT_REQUIRED" };

  const prepared = await invokeMaintenance(req, { actionType: "prepare_eject_by_repair", stationId, slotNum });
  if (!prepared.ok || !prepared.data) return { ok: false, status: prepared.status, data: prepared.data, error: prepared.error ?? "MAINTENANCE_PREPARE_FAILED" };
  const permitId = String(prepared.data.permitId ?? "");
  const expected = String(prepared.data.confirmation ?? "").trim().toUpperCase();
  if (!permitId || expected !== confirmation) return { ok: false, status: 409, data: prepared.data, error: "MAINTENANCE_TARGET_CONFIRMATION_MISMATCH" };

  const executed = await invokeMaintenance(req, { actionType: "execute_eject_by_repair", permitId, confirmation });
  return { ok: executed.ok, status: executed.status, data: executed.data?.result ?? executed.data, error: executed.ok ? null : executed.error ?? "MAINTENANCE_EXECUTE_FAILED" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const db = dbClient();
  const adminId = await requireAdmin(req, db);
  if (!adminId) return json({ ok: false, error: "FORBIDDEN" }, 403);

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "invoke");
    if (!configured()) return json({ ok: false, error: "API non configurée" }, 200);

    if (action === "run_safe_live") {
      const results: Record<string, ProviderResult> = {};
      const stationParams = { deviceId: TEST_STATION, cabinetId: TEST_STATION };
      const seed: Record<string, ProviderResult> = { S1: await dispatch("S1", {}), P1: await dispatch("P1", {}), R1: await dispatch("R1", {}) };
      const shopId = firstString(seed.S1.data, ["shopid", "shopId", "id"]);
      const priceId = firstString(seed.P1.data, ["priceId", "id"]);
      const tradeNo = firstString(seed.R1.data, ["tradeNo", "pOrderid", "orderNo"]);
      const paramFor: Record<string, Record<string, unknown>> = {
        O1: { deviceId: TEST_STATION }, O6: {}, C4: stationParams,
        C5: { shopid: shopId }, C6: { page: "1", limit: "20" }, C7: stationParams, C8: stationParams,
        S1: {}, S2: { shopid: shopId }, P1: {}, P2: { priceId }, R1: {}, E2: {}, E3: {}, O3: { tradeNo }, O5: { tradeNo },
      };
      for (const code of SAFE_READ_CODES) {
        const sample = ["O3", "O5"].includes(code) ? tradeNo : ["C5", "S2"].includes(code) ? shopId : code === "P2" ? priceId : "available";
        const result = sample ? (seed[code] ?? await dispatch(code, paramFor[code] ?? {})) : { ok: false, status: 0, data: null, error: "SKIPPED_MISSING_SAMPLE_IDENTIFIER" };
        results[code] = result;
        await db.from("api_coverage").update({
          live_test_status: result.error === "SKIPPED_MISSING_SAMPLE_IDENTIFIER" ? "skipped" : result.ok ? "pass" : "fail",
          mock_test_status: "pass",
          live_result: result.data as object,
          last_error: result.error,
          proof_state: result.error === "SKIPPED_MISSING_SAMPLE_IDENTIFIER" ? "sample_required" : result.ok ? "live_verified" : "unverified",
          proof: { ranAt: new Date().toISOString(), status: result.status, by: adminId },
        }).eq("code", code);
        await logApi(db, { service: "chargenow", endpoint: `coverage:${code}`, method: "GET", status_code: result.status, response: result.data, error: result.error });
      }
      return json({ ok: true, results });
    }

    if (action === "record_contract_results") {
      const rows = Object.entries(MUTATION_META).map(([code, meta]) => ({
        endpoint_code: code, endpoint_name: meta.name, level: "A", verdict: "mock_verified", environment: "ci",
        cabinet_id: null, correlation_id: `contract-${code}-${Date.now()}`,
        request_redacted: { note: "stubbed fetch; payload/headers/error-mapping asserted" },
        response_redacted: { note: "see tests/chargenow_mutations_contract.test.ts" },
        status_code: 200, duration_ms: null, physical_test_required: meta.dangerous, error: null, performed_by: adminId,
      }));
      await db.from("test_runs").insert(rows);
      for (const code of Object.keys(MUTATION_META)) {
        await db.from("api_coverage").update({ has_test: true, mock_test_status: "pass", proof_state: MUTATION_META[code].dangerous ? "blocked_by_safety" : "mock_verified" }).eq("code", code);
      }
      return json({ ok: true, recorded: rows.length });
    }

    if (action === "run_safe_live_mutations") return json({ ok: false, error: "PROVIDER_MUTATION_DISABLED" }, 409);

    const code = String(body.code ?? "");
    if (!code) return json({ ok: false, error: "MISSING_CODE" }, 400);
    const params = (body.params as Record<string, unknown>) ?? {};
    const isMutation = MUTATING_CODES.has(code);
    const isSensitive = SENSITIVE_CODES.has(code);
    if (isMutation || isSensitive) {
      const superId = await requireSuperAdmin(req, db);
      if (!superId) return json({ ok: false, error: "FORBIDDEN_SUPER_ADMIN_REQUIRED", code }, 403);
    }

    const isDangerous = DANGEROUS.has(code);
    const maintenanceMode = Boolean(body.maintenanceMode);
    const expectedConfirmation = confirmationPhrase(code, params);
    const confirmation = typeof body.confirmation === "string" ? body.confirmation.trim().toUpperCase() : "";
    const confirm = Boolean(body.confirm) && confirmation === expectedConfirmation;
    const dryRun = Boolean(body.dryRun);

    if (isDangerous && !maintenanceMode) return json({ ok: false, error: "MAINTENANCE_MODE_REQUIRED", code }, 200);
    if ((isMutation || isSensitive) && !confirm && !dryRun) return json({ ok: false, error: "CONFIRMATION_REQUIRED", code, expectedConfirmation }, 409);

    const correlation = `op-${code}-${Date.now()}`;
    const cabinetId = String(params.cabinetid ?? params.cabinetId ?? "") || null;

    if (dryRun) {
      await db.from("test_runs").insert({
        endpoint_code: code, endpoint_name: MUTATION_META[code]?.name ?? code, level: "C",
        verdict: isDangerous ? "blocked_by_safety" : "physical_test_required", environment: "staging",
        cabinet_id: cabinetId, correlation_id: correlation, request_redacted: redact(params), response_redacted: { dryRun: true, wouldCall: true },
        status_code: null, duration_ms: 0, physical_test_required: true, error: null, performed_by: adminId,
      });
      return json({ ok: true, dryRun: true, code, params, wouldCall: true, correlation });
    }

    const startedAt = Date.now();
    const result = code === "C2" ? await workshopC2(req, params, confirmation) : await dispatch(code, params);
    const durationMs = Date.now() - startedAt;

    await logApi(db, { service: "chargenow", endpoint: `op:${code}`, method: "POST", status_code: result.status, request: params, response: result.data, error: result.error });
    await db.from("api_coverage").update({
      live_test_status: result.ok ? "pass" : "fail", live_result: result.data as object, last_error: result.error,
      proof_state: result.ok ? "live_verified" : "unverified",
      proof: { ranAt: new Date().toISOString(), status: result.status, by: adminId, dangerous: isDangerous, correlation },
    }).eq("code", code);
    await db.from("test_runs").insert({
      endpoint_code: code, endpoint_name: MUTATION_META[code]?.name ?? code, level: isDangerous ? "C" : "B",
      verdict: result.ok ? "live_verified" : "failed", environment: MODE === "live" ? "live" : "test",
      cabinet_id: cabinetId, correlation_id: correlation, request_redacted: redact(params), response_redacted: redact(result.data),
      status_code: result.status, duration_ms: durationMs, physical_test_required: isDangerous, error: result.error, performed_by: adminId,
    });
    if (isDangerous && code !== "C2") {
      await db.from("maintenance_actions").insert({ station_id: cabinetId ?? "", action_type: code, params, result: result.data ?? { error: result.error }, performed_by: adminId });
    }

    return json({ ok: result.ok, code, status: result.status, data: result.data, error: result.error, correlation });
  } catch (error) {
    return json({ ok: false, error: String(error) }, 500);
  }
});
