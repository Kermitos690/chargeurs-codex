const BASE_URL = (process.env.CHARGENOW_API_BASE_URL || "https://developer.chargenow.top/cdb-open-api/v1").replace(/\/$/, "");
const BASIC_USER = process.env.CHARGENOW_BASIC_USERNAME || "";
const BASIC_PASS = process.env.CHARGENOW_BASIC_PASSWORD || "";
const BASIC_AUTH = (process.env.CHARGENOW_BASIC_AUTH || "").replace(/^Basic\s+/i, "").trim();
const parsedTimeoutMs = Number(process.env.CHARGENOW_TIMEOUT_MS || 10000);
const TIMEOUT_MS = Number.isInteger(parsedTimeoutMs) && parsedTimeoutMs >= 1000 && parsedTimeoutMs <= 30000
  ? parsedTimeoutMs
  : 10000;

export function isChargeNowConfigured() {
  return Boolean(BASIC_AUTH || (BASIC_USER && BASIC_PASS));
}

function authHeader() {
  if (BASIC_AUTH) return `Basic ${BASIC_AUTH}`;
  return `Basic ${Buffer.from(`${BASIC_USER}:${BASIC_PASS}`, "utf8").toString("base64")}`;
}

async function request(method, path, query = {}) {
  if (!isChargeNowConfigured()) {
    return { ok: false, status: 0, data: null, error: "CHARGENOW_NOT_CONFIGURED" };
  }
  const url = new URL(`${BASE_URL}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }

  try {
    const response = await fetch(url, {
      method,
      headers: { Accept: "application/json", Authorization: authHeader() },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    const bizCode = data && typeof data === "object" ? data.code : undefined;
    const bizOk = bizCode === undefined ? response.ok : Number(bizCode) === 0;
    return {
      ok: response.ok && bizOk,
      status: response.status,
      data,
      error: response.ok && bizOk ? null : `HTTP_${response.status}${bizCode !== undefined ? `_CODE_${bizCode}` : ""}`,
    };
  } catch (error) {
    return { ok: false, status: 0, data: null, error: error instanceof Error ? error.message : String(error) };
  }
}

// Read-only subset only. No ChargeNow mutation helper exists in the pilot API yet.
export const cabinetQuery = (deviceId) => request("GET", "/rent/cabinet/query", { deviceId });
export const cabinetDetail = (cabinetId) => request("GET", `/cabinet/detail/${encodeURIComponent(cabinetId)}`);
export const batteryListByCabinetId = (cabinetId) => request("GET", `/cabinet/batteryListByCabinetId/${encodeURIComponent(cabinetId)}`);
export const slotByCabinetId = (cabinetId) => request("GET", `/cabinet/slotByCabinetId/${encodeURIComponent(cabinetId)}`);
