// ============================================================
// Chargeurs.ch — ChargeNow / Bajie (Apifox-documented) API client
// PRODUCTION base: https://developer.chargenow.top/cdb-open-api/v1
//
// SECURITY:
//  - Credentials come ONLY from backend env vars (never frontend).
//  - This module is used exclusively inside edge functions.
//  - Dangerous endpoints (ejectByRepair, operation/pop, price/shop/device
//    mutations) live here but MUST only be called from admin-gated functions.
// ============================================================

const BASE_URL =
  Deno.env.get("CHARGENOW_API_BASE_URL") ??
  "https://developer.chargenow.top/cdb-open-api/v1";

const BASIC_USER = Deno.env.get("CHARGENOW_BASIC_USERNAME") ?? "";
const BASIC_PASS = Deno.env.get("CHARGENOW_BASIC_PASSWORD") ?? "";

export function isChargeNowConfigured(): boolean {
  return Boolean(BASIC_USER && BASIC_PASS);
}

function authHeader(): string {
  return "Basic " + btoa(`${BASIC_USER}:${BASIC_PASS}`);
}

export interface ApiResult<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
}

async function request<T = unknown>(
  method: string,
  path: string,
  opts: { query?: Record<string, string | number | undefined>; body?: unknown } = {},
): Promise<ApiResult<T>> {
  if (!isChargeNowConfigured()) {
    return { ok: false, status: 0, data: null, error: "CHARGENOW_NOT_CONFIGURED" };
  }

  const url = new URL(BASE_URL.replace(/\/$/, "") + path);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }

  try {
    const res = await fetch(url.toString(), {
      method,
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });

    const text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }

    return {
      ok: res.ok,
      status: res.status,
      data: data as T,
      error: res.ok ? null : `HTTP_${res.status}`,
    };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: String(e) };
  }
}

// ---------- 1. Cabinet / Station info ----------
export const cabinetQuery = (deviceId: string) =>
  request("GET", "/rent/cabinet/query", { query: { deviceId } });

export const cabinetDetail = (cabinetId: string) =>
  request("GET", `/cabinet/detail/${cabinetId}`);

export const batteryListByCabinetId = (cabinetId: string) =>
  request("GET", `/cabinet/batteryListByCabinetId/${cabinetId}`);

export const slotByCabinetId = (cabinetId: string) =>
  request("GET", `/cabinet/slotByCabinetId/${cabinetId}`);

// ---------- 2. Rental order management ----------
export const orderCreate = (body: Record<string, unknown>) =>
  request("POST", "/rent/order/create", { body });

export const orderQuery = (body: Record<string, unknown>) =>
  request("POST", "/rent/order/query", { body });

export const orderDetail = (tradeNo: string) =>
  request("GET", "/rent/order/detail", { query: { orderId: tradeNo } });

export const orderClose = (body: Record<string, unknown>) =>
  request("POST", "/rent/order/close", { body });

// ---------- 3. Battery ejection for rental (after Stripe success only) ----------
export const ejectByRent = (cabinetid: string, slotNum: number, tradeNo?: string) =>
  request("POST", "/cabinet/ejectByRent", {
    body: { cabinetid, slotNum, rentOrderId: tradeNo, tradeNo },
  });

// ---------- 4. Maintenance (ADMIN ONLY — never from public kiosk) ----------
// ⚠️ DANGEROUS: forcibly ejects without a paid rental.
export const ejectByRepair = (cabinetid: string, slotNum: number) =>
  request("POST", "/cabinet/ejectByRepair", { body: { cabinetid, slotNum } });

// ⚠️ DANGEROUS: hardware operation pop.
export const operationPop = (cabinetid: string, slotNum: number) =>
  request("POST", "/cabinet/operation", { body: { cabinetid, slotNum, operationType: "pop" } });

// ---------- 5. Event push config ----------
export const eventPushConfig = (url: string) =>
  request("POST", "/cabinet/eventPush/config", { body: { url } });

export { BASE_URL };
