// ============================================================
// Chargeurs.ch — ChargeNow / Bajie (Apifox-documented) API client
// PRODUCTION base: https://developer.chargenow.top/cdb-open-api/v1
//
// EXHAUSTIVE: implements all 35 documented operations
//   A1, O1-O7, C1-C12, S1-S5, P1-P6, R1, E1-E3
// Routes/methods/params verified against the Apifox documentation
// (project 4855b8fe-4c43-48f6-8bd6-37cc29b98fe5).
//
// SECURITY:
//  - Credentials come ONLY from backend env vars (never frontend).
//  - Used exclusively inside edge functions.
//  - Dangerous endpoints (operation, ejectByRepair, bind/unbind, delete,
//    publishAd) MUST only be called from admin-gated functions with dry-run.
// ============================================================

const BASE_URL =
  Deno.env.get("CHARGENOW_API_BASE_URL") ??
  "https://developer.chargenow.top/cdb-open-api/v1";

const BASIC_USER = Deno.env.get("CHARGENOW_BASIC_USERNAME") ?? "";
const BASIC_PASS = Deno.env.get("CHARGENOW_BASIC_PASSWORD") ?? "";
// Preferred: store the ready-made base64 token (everything after "Basic ").
const BASIC_AUTH = Deno.env.get("CHARGENOW_BASIC_AUTH") ?? "";

export function isChargeNowConfigured(): boolean {
  return Boolean(BASIC_AUTH || (BASIC_USER && BASIC_PASS));
}

function authHeader(): string {
  if (BASIC_AUTH) return "Basic " + BASIC_AUTH.replace(/^Basic\s+/i, "").trim();
  return "Basic " + btoa(`${BASIC_USER}:${BASIC_PASS}`);
}

export interface ApiResult<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
}

type Query = Record<string, string | number | boolean | undefined | null>;

async function request<T = unknown>(
  method: string,
  path: string,
  opts: { query?: Query; body?: unknown; bearer?: string } = {},
): Promise<ApiResult<T>> {
  if (!isChargeNowConfigured() && !opts.bearer) {
    return { ok: false, status: 0, data: null, error: "CHARGENOW_NOT_CONFIGURED" };
  }

  const url = new URL(BASE_URL.replace(/\/$/, "") + path);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: opts.bearer ? `Bearer ${opts.bearer}` : authHeader(),
  };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  try {
    const res = await fetch(url.toString(), {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    // ChargeNow returns {code:0} on success even with HTTP 200; surface code.
    const bizCode = (data as { code?: number } | null)?.code;
    const bizOk = bizCode === undefined ? res.ok : bizCode === 0;
    return {
      ok: res.ok && bizOk,
      status: res.status,
      data: data as T,
      error: res.ok && bizOk ? null : `HTTP_${res.status}${bizCode !== undefined ? `_CODE_${bizCode}` : ""}`,
    };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: String(e) };
  }
}

// ============================================================
// A1 — AUTH : OAuth2 login (password must be SHA256-hashed by caller)
// ============================================================
export const oauth2Login = (username: string, passwordSha256: string) =>
  request("POST", "/oauth2/login", { query: { username, password: passwordSha256 } });

// ============================================================
// OPEN API (O1-O7)
// ============================================================
// O1 — Get Device Info
export const cabinetQuery = (deviceId: string) =>
  request("GET", "/rent/cabinet/query", { query: { deviceId } });

// O7 — Get Device Info (POST variant)
export const cabinetQueryPost = (deviceId: string) =>
  request("POST", "/rent/cabinet/query", { query: { deviceId } });

// O2 — Create Rent Order (query params: deviceId, callbackURL)
export const orderCreate = (args: { deviceId: string; callbackURL?: string }) =>
  request("POST", "/rent/order/create", {
    query: { deviceId: args.deviceId, callbackURL: args.callbackURL },
  });

// O3 — Query Rent Order Status (query: tradeNo)
export const orderQuery = (tradeNo: string) =>
  request("POST", "/rent/order/query", { query: { tradeNo } });

// O4 — Mark Order Completed / Close (query: tradeNo)
export const orderClose = (args: { tradeNo: string } | string) => {
  const tradeNo = typeof args === "string" ? args : args.tradeNo;
  return request("POST", "/rent/order/close", { query: { tradeNo } });
};

// O5 — Get Order Detail (query: tradeNo)
export const orderDetail = (tradeNo: string) =>
  request("GET", "/rent/order/detail", { query: { tradeNo } });

// O6 — Get Device List (geolocated)
export const cabinetListGeo = (args: {
  coordType: string; zoomLevel: string | number; lat: string | number; lng: string | number; showPrice?: boolean;
}) =>
  request("POST", "/rent/cabinet/list", {
    query: {
      coordType: args.coordType, zoomLevel: args.zoomLevel,
      lat: args.lat, lng: args.lng, showPrice: args.showPrice ?? true,
    },
  });

// ============================================================
// ADVANCE API — CABINET (C1-C12)
// ============================================================
// C1 — Device Operation (restart,pop,popall,popallForNoAuth,popallForAuth,heartbeat,lock,unlock,lockStopCharge,report)
export type CabinetOperationType =
  | "restart" | "pop" | "popall" | "popallForNoAuth" | "popallForAuth"
  | "heartbeat" | "lock" | "unlock" | "lockStopCharge" | "report";
export const cabinetOperation = (args: {
  cabinetid: string; slotNum?: number; operationType: CabinetOperationType; reason?: string;
}) =>
  request("POST", "/cabinet/operation", {
    query: {
      cabinetid: args.cabinetid, slotNum: args.slotNum,
      operationType: args.operationType, reason: args.reason ?? "admin",
    },
  });
// Back-compat helper used by older callers.
export const operationPop = (cabinetid: string, slotNum: number) =>
  cabinetOperation({ cabinetid, slotNum, operationType: "pop" });

// C2 — Eject By Repair (query: cabinetid, slotNum). 0/null = eject all.
export const ejectByRepair = (cabinetid: string, slotNum: number) =>
  request("POST", "/cabinet/ejectByRepair", { query: { cabinetid, slotNum } });

// C3 — Eject By Rent (query: cabinetid, rentOrderId, slotNum)
export const ejectByRent = (cabinetid: string, slotNum: number, rentOrderId?: string) =>
  request("POST", "/cabinet/ejectByRent", { query: { cabinetid, rentOrderId, slotNum } });

// C4 — Cabinet Detail
export const cabinetDetail = (cabinetId: string) =>
  request("GET", `/cabinet/detail/${encodeURIComponent(cabinetId)}`);

// C5 — Devices By Shop
export const getDeviceByShopId = (shopid: string) =>
  request("GET", "/cabinet/getDeviceByShopId", { query: { shopid } });

// C6 — All Devices Paged
export const getAllDevicePage = (page: number | string = 1, limit: number | string = 20) =>
  request("GET", "/cabinet/getAllDevicePage", { query: { page, limit } });

// C7 — Battery List By Cabinet
export const batteryListByCabinetId = (cabinetId: string) =>
  request("GET", `/cabinet/batteryListByCabinetId/${encodeURIComponent(cabinetId)}`);

// C8 — Slot List By Cabinet
export const slotByCabinetId = (cabinetId: string) =>
  request("GET", `/cabinet/slotByCabinetId/${encodeURIComponent(cabinetId)}`);

// C9 — Bind Device To Shop
export const bind2shop = (qrcode: string, newshopid: string) =>
  request("POST", `/cabinet/bind2shop/${encodeURIComponent(qrcode)}/${encodeURIComponent(newshopid)}`);

// C10 — Update Cabinet Advertising
export const bindAd = (body: {
  cabinetIdList: string[]; isRestart?: boolean; adConfigList: unknown[];
}) => request("POST", "/cabinet/bindAd", { body });

// C11 — Unbind Device From Shop
export const unbindShop = (deviceIds: string[]) =>
  request("POST", "/cabinet/unbindShop", { body: deviceIds });

// C12 — Publish Advertisement
export const publishAd = (body: {
  cabinetIdList: string[]; restart?: boolean; adConfigList: unknown[];
}) => request("POST", "/cabinet/publishAd", { body });

// ============================================================
// ADVANCE API — SHOP (S1-S5)
// ============================================================
// S1 — Get All Shop List
export const getShopList = () => request("GET", "/shop/getShopList");

// S2 — Get Shop Detail
export const shopDetail = (shopid: string) =>
  request("GET", `/shop/detail/${encodeURIComponent(shopid)}`);

// S3 — Create New Shop
export const shopCreate = (body: Record<string, unknown>) =>
  request("POST", "/shop/create", { body });

// S4 — Update Shop
export const shopUpdate = (body: Record<string, unknown>) =>
  request("PUT", "/shop/update", { body });

// S5 — Delete Shop
export const shopDelete = (shopid: string) =>
  request("DELETE", `/shop/delete/${encodeURIComponent(shopid)}`);

// ============================================================
// ADVANCE API — PRICE STRATEGY (P1-P6)
// ============================================================
// P1 — Get Price Strategy Page
export const priceStrategyPage = (body: {
  size?: number; current?: number; shopId?: string; priceId?: number; name?: string;
} = {}) => request("POST", "/shop/priceStrategy/page", {
  body: { size: body.size ?? 10, current: body.current ?? 1, ...body },
});

// P2 — Get Price Strategy Detail
export const priceStrategyDetail = (priceId: string | number) =>
  request("GET", `/shop/priceStrategy/detail/${encodeURIComponent(String(priceId))}`);

// P3 — Create Or Update Price Strategy
export interface PriceStrategyDetailRow {
  startMinute: number; endMinute: number; setcionFee: number; totalFee: number; seqno: number;
}
export const priceStrategySave = (body: {
  priceId?: number; name: string; shopId?: string; type?: number; customType?: number;
  priority?: number; isDeposit?: boolean; depositAmount?: number; timeoutAmount?: number;
  timeoutDay?: number; freeMinutes?: number; dayUseFreeCount?: number; price?: number;
  priceTime?: number; priceUnit?: number; dailyMaxPrice?: number;
  priceStrategyDetailList?: PriceStrategyDetailRow[];
}) => request("POST", "/shop/priceStrategy/saveOrUpdate", { body });

// P4 — Delete Price Strategy (body: array of priceIds)
export const priceStrategyDelete = (priceIds: number[]) =>
  request("POST", "/shop/priceStrategy/delete", { body: priceIds });

// P5 — Shop Bind Price Strategy
export const priceStrategyBind = (args: { shopId: string; priceId: number; customType?: number }) =>
  request("POST", "/shop/priceStrategy/bindShop", {
    body: { shopId: args.shopId, priceId: args.priceId, customType: args.customType ?? 0 },
  });

// P6 — Shop Unbind Price Strategy
export const priceStrategyUnbind = (args: { shopId: string; customType?: number }) =>
  request("POST", "/shop/priceStrategy/unbindShop", {
    body: { shopId: args.shopId, customType: args.customType ?? 0 },
  });

// ============================================================
// ADVANCE API — ORDER (R1)
// ============================================================
// R1 — Order List
export const orderList = (filters: Query = {}) =>
  request("GET", "/order/list", { query: filters });

// ============================================================
// CABINET EVENT PUSH (E1-E2 ; E3 is our own receiver function)
// ============================================================
export interface EventSubscription { event: string; pushUrl?: string; enable?: boolean; }
// E1 — Configure event push
export const eventPushConfig = (pushUrl: string, eventSubscriptions?: EventSubscription[]) =>
  request("POST", "/cabinet/eventPush/config", {
    body: { pushUrl, eventSubscriptions: eventSubscriptions ?? [] },
  });

// E2 — Get current event push config
export const eventPushConfigGet = () =>
  request("GET", "/cabinet/eventPush/config/get");

export const ALL_EVENT_TYPES = [
  "CABINET_ONLINE", "CABINET_OFFLINE", "CABINET_STATUS", "BATTERY_IN",
  "BATTERY_BORROW_OUT", "BATTERY_ABNORMAL_WARNING", "BATTERY_POPUP", "ADMIN_RENTAL_ORDER",
] as const;

export { BASE_URL };
