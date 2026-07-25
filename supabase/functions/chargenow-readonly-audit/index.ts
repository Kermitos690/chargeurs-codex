import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CHARGENOW_BASE_URL = (Deno.env.get("CHARGENOW_API_BASE_URL") ?? "https://developer.chargenow.top/cdb-open-api/v1").replace(/\/$/, "");
const TIMEOUT_MS = 12_000;
const PILOT_STATION = "DTA21269";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

type UnknownRecord = Record<string, unknown>;
type ProviderResult = {
  ok: boolean;
  status: number;
  data: unknown;
  error: string | null;
  businessCode: string | number | null;
};

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function firstRecord(record: UnknownRecord, keys: string[]): UnknownRecord | null {
  for (const key of keys) if (isRecord(record[key])) return record[key] as UnknownRecord;
  return null;
}

function firstDefined(record: UnknownRecord, keys: string[]): unknown {
  for (const key of keys) if (record[key] !== undefined && record[key] !== null) return record[key];
  return undefined;
}

function firstArray(record: UnknownRecord, keys: string[]): unknown[] {
  for (const key of keys) if (Array.isArray(record[key])) return record[key] as unknown[];
  return [];
}

function unwrap(value: unknown): UnknownRecord {
  let current = isRecord(value) ? value : {};
  for (let depth = 0; depth < 5; depth += 1) {
    const hasShape = ["cabinet", "shop", "priceStrategy", "batteries", "batteryList", "slots", "slotList"].some((key) => current[key] !== undefined);
    if (hasShape) return current;
    const next = firstRecord(current, ["data", "result", "payload"]);
    if (!next) return current;
    current = next;
  }
  return current;
}

function asString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || String(value).toLowerCase() === "online" || String(value).toLowerCase() === "true") return true;
  if (value === 0 || value === "0" || String(value).toLowerCase() === "offline" || String(value).toLowerCase() === "false") return false;
  return null;
}

function businessCode(data: unknown): string | number | null {
  if (!isRecord(data) || data.code === undefined || data.code === null) return null;
  return typeof data.code === "string" || typeof data.code === "number" ? data.code : null;
}

async function requireAdmin(req: Request, db: ReturnType<typeof createClient>): Promise<string | null> {
  const authorization = req.headers.get("Authorization") ?? "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const { data: { user }, error } = await db.auth.getUser(token);
  if (error || !user) return null;
  const { data: roles } = await db.from("user_roles").select("role").eq("user_id", user.id);
  const allowed = new Set(["super_admin", "admin", "operations_admin"]);
  return (roles ?? []).some((row: { role: string }) => allowed.has(row.role)) ? user.id : null;
}

async function loadCredentials(db: ReturnType<typeof createClient>): Promise<{ username: string; password: string } | null> {
  const envUsername = (Deno.env.get("CHARGENOW_BASIC_USERNAME") ?? "").trim();
  const envPassword = Deno.env.get("CHARGENOW_BASIC_PASSWORD") ?? "";
  if (envUsername && envPassword) return { username: envUsername, password: envPassword };

  const { data, error } = await db.rpc("chargeurs_get_chargenow_credentials");
  if (error) throw new Error("CHARGENOW_VAULT_READ_FAILED");
  const row = Array.isArray(data) ? data[0] : data;
  const username = typeof row?.secret_username === "string" ? row.secret_username.trim() : "";
  const password = typeof row?.secret_password === "string" ? row.secret_password : "";
  return username && password ? { username, password } : null;
}

async function providerGet(path: string, authorization: string): Promise<ProviderResult> {
  try {
    const response = await fetch(`${CHARGENOW_BASE_URL}${path}`, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: authorization },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await response.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    const code = businessCode(data);
    const businessOk = code === null || String(code).trim() === "0";
    return {
      ok: response.ok && businessOk,
      status: response.status,
      data,
      error: response.ok && businessOk ? null : `HTTP_${response.status}${code === null ? "" : `_CODE_${code}`}`,
      businessCode: code,
    };
  } catch (error) {
    return { ok: false, status: 0, data: null, error: error instanceof Error ? error.message : "CHARGENOW_UNREACHABLE", businessCode: null };
  }
}

function normalizeSnapshot(stationId: string, core: ProviderResult, supplementary: Record<string, ProviderResult>) {
  const payload = unwrap(core.data);
  const cabinet = firstRecord(payload, ["cabinet", "device", "cabinetInfo", "deviceInfo"]) ?? {};
  const shop = firstRecord(payload, ["shop", "merchant", "venue"]) ?? {};
  const pricing = firstRecord(payload, ["priceStrategy", "price", "pricing", "strategy"]) ?? {};
  const batteryList = firstArray(payload, ["batteries", "batteryList", "powerBanks", "powerbanks"]);

  const batteries = batteryList.flatMap((item) => {
    if (!isRecord(item)) return [];
    const batteryId = asString(firstDefined(item, ["batteryId", "batteryID", "batterySn", "batterySN", "sn", "powerBankId"]));
    if (!batteryId) return [];
    return [{
      batteryId,
      slotNum: asNumber(firstDefined(item, ["slotNum", "slot", "slotId", "port", "channel"])),
      powerLevel: asNumber(firstDefined(item, ["vol", "capacity", "batteryCapacity", "power", "electricity", "soc"])),
    }];
  });

  const totalSlots = asNumber(firstDefined(cabinet, ["slots", "slotNum", "totalSlots", "capacity", "slotCount"]));
  const rentableCount = asNumber(firstDefined(cabinet, ["busySlots", "rentableCount", "availableBatteryNum", "canRentNum"])) ?? batteries.length;
  const returnableCount = asNumber(firstDefined(cabinet, ["emptySlots", "returnableCount", "canReturnNum"])) ?? (totalSlots === null ? null : Math.max(0, totalSlots - rentableCount));

  return {
    stationId,
    cabinetId: asString(firstDefined(cabinet, ["id", "cabinetId", "deviceId"])) ?? stationId,
    collectedAt: new Date().toISOString(),
    providerReachable: core.status > 0,
    stateKnown: core.ok && (Object.keys(cabinet).length > 0 || batteries.length > 0),
    online: asBoolean(firstDefined(cabinet, ["online", "isOnline", "onlineStatus", "status"])),
    signal: asNumber(firstDefined(cabinet, ["signal", "signalStrength", "rssi"])),
    totalSlots,
    rentableCount,
    returnableCount,
    shop: {
      id: asString(firstDefined(shop, ["id", "shopId"])),
      name: asString(firstDefined(shop, ["name", "shopName"])),
      address: asString(firstDefined(shop, ["address", "shopAddress"])),
      latitude: asString(firstDefined(shop, ["latitude", "lat"])),
      longitude: asString(firstDefined(shop, ["longitude", "lng", "lon"])),
    },
    pricing: {
      name: asString(firstDefined(pricing, ["name", "priceName", "strategyName"])),
      currency: asString(firstDefined(pricing, ["currency", "currencyCode", "currencySymbol"])),
      depositAmount: asNumber(firstDefined(pricing, ["depositAmount", "deposit"])),
      price: asNumber(firstDefined(pricing, ["price", "unitPrice"])),
      priceMinute: asNumber(firstDefined(pricing, ["priceMinute", "priceTime", "billingMinutes"])),
      freeMinutes: asNumber(firstDefined(pricing, ["freeMinutes", "freeDuration"])),
      dailyMaxPrice: asNumber(firstDefined(pricing, ["dailyMaxPrice", "dailyCapAmount"])),
      timeoutAmount: asNumber(firstDefined(pricing, ["timeoutAmount", "overtimeAmount"])),
      timeoutDay: asNumber(firstDefined(pricing, ["timeoutDay", "overtimeDays"])),
    },
    batteries,
    attempts: [
      { source: "core", endpoint: "/rent/cabinet/query", status: core.status, ok: core.ok, businessCode: core.businessCode, error: core.error },
      ...Object.entries(supplementary).map(([source, result]) => ({ source, status: result.status, ok: result.ok, businessCode: result.businessCode, error: result.error })),
    ],
    providerPayload: payload,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json({ ok: false, error: "SUPABASE_ENV_MISSING" }, 500);

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const actor = await requireAdmin(req, db);
  if (!actor) return json({ ok: false, error: "ADMIN_REQUIRED" }, 403);

  const body = await req.json().catch(() => ({}));
  const stationId = typeof body.stationId === "string" && body.stationId.trim() ? body.stationId.trim() : PILOT_STATION;
  if (stationId !== PILOT_STATION) return json({ ok: false, error: "PILOT_STATION_ONLY", stationId }, 403);

  try {
    const credentials = await loadCredentials(db);
    if (!credentials) return json({ ok: false, error: "CHARGENOW_CREDENTIALS_MISSING" }, 503);
    const authorization = `Basic ${btoa(`${credentials.username}:${credentials.password}`)}`;

    const core = await providerGet(`/rent/cabinet/query?deviceId=${encodeURIComponent(stationId)}`, authorization);
    const supplementary: Record<string, ProviderResult> = {};
    if (core.ok) {
      const results = await Promise.all([
        providerGet(`/cabinet/detail/${encodeURIComponent(stationId)}`, authorization),
        providerGet(`/cabinet/batteryListByCabinetId/${encodeURIComponent(stationId)}`, authorization),
        providerGet(`/cabinet/slotByCabinetId/${encodeURIComponent(stationId)}`, authorization),
      ]);
      supplementary.cabinet_detail = results[0];
      supplementary.battery_list = results[1];
      supplementary.slot_list = results[2];
    }

    const snapshot = normalizeSnapshot(stationId, core, supplementary);

    await db.from("api_logs").insert({
      service: "chargenow-readonly",
      endpoint: "/rent/cabinet/query",
      method: "GET",
      status_code: core.status,
      request: { stationId },
      response: { ok: core.ok, businessCode: core.businessCode, stateKnown: snapshot.stateKnown },
      error: core.error,
    });

    await db.from("audit_logs").insert({
      actor,
      action: "chargenow.readonly_snapshot",
      target: stationId,
      data: { providerReachable: snapshot.providerReachable, stateKnown: snapshot.stateKnown, attemptCount: snapshot.attempts.length },
    });

    if (core.ok && snapshot.stateKnown) {
      await db.from("stations").update({
        status: snapshot.online === true ? "online" : snapshot.online === false ? "offline" : "unknown",
        online: snapshot.online === true,
        signal: snapshot.signal,
        rentable_count: snapshot.rentableCount,
        returnable_count: snapshot.returnableCount,
        total_count: snapshot.totalSlots,
        last_sync_at: snapshot.collectedAt,
        raw_data: snapshot.providerPayload,
      }).eq("station_id", stationId);

      for (const battery of snapshot.batteries) {
        if (battery.slotNum === null) continue;
        await db.from("slots").upsert({
          station_id: stationId,
          slot_num: battery.slotNum,
          status: "occupied",
          battery_id: battery.batteryId,
          raw_data: battery,
        }, { onConflict: "station_id,slot_num" });
        await db.from("batteries").upsert({
          battery_id: battery.batteryId,
          station_id: stationId,
          slot_num: battery.slotNum,
          status: "in_station",
          power_level: battery.powerLevel,
          raw_data: battery,
        }, { onConflict: "battery_id" });
      }
    }

    if (!core.ok) {
      const error = [401, 403].includes(core.status) ? "CHARGENOW_AUTH_REJECTED"
        : core.status === 404 ? "CHARGENOW_DEVICE_NOT_FOUND"
        : core.status === 0 ? "CHARGENOW_UNREACHABLE"
        : "CHARGENOW_PROVIDER_ERROR";
      return json({ ok: false, readOnly: true, error, snapshot }, 502);
    }

    return json({ ok: true, readOnly: true, snapshot });
  } catch (error) {
    console.error("chargenow-readonly-audit", error instanceof Error ? error.message : "UNKNOWN_ERROR");
    return json({ ok: false, error: error instanceof Error ? error.message : "INTERNAL_ERROR" }, 500);
  }
});
