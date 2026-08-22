import { resolveRentSlot } from "./chargenowSafety.ts";

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
const CHARGENOW_MODE = (Deno.env.get("CHARGENOW_MODE") ?? "test").trim().toLowerCase();
const parsedTimeoutMs = Number(Deno.env.get("CHARGENOW_TIMEOUT_MS") ?? "10000");
const TIMEOUT_MS = Number.isInteger(parsedTimeoutMs) && parsedTimeoutMs >= 1_000 && parsedTimeoutMs <= 30_000
  ? parsedTimeoutMs
  : 10_000;

export function areChargeNowMutationsEnabled(): boolean {
  return Deno.env.get("CHARGENOW_MUTATIONS_ENABLED") === "true";
}

// A supplier mutation gate alone is deliberately insufficient for a customer
// rental: a staged maintenance trial must never make paid-rental ejection live.
export function areHardwareEjectionsEnabled(): boolean {
  return areChargeNowMutationsEnabled() && Deno.env.get("HARDWARE_EJECTION_ENABLED") === "true";
}

// A supplier response alone is not proof that C3 releases exactly one requested
// slot. This is shared by customer rentals and physical qualification so a
// staging diagnostic can never silently bypass the same supplier contract.
export function hasVerifiedSingleSlotRentalContract(): boolean {
  return Deno.env.get("CHARGENOW_SINGLE_SLOT_RENTAL_CONTRACT") === "verified";
}

export function chargeNowMode(): "test" | "live" {
  return CHARGENOW_MODE === "live" ? "live" : "test";
}

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

// Administrative confirmation is still required by the calling Edge Function,
// but it can never bypass the global provider-mutation kill switch.
export type SuperAdminMutationContext = { superAdminConfirmed?: boolean };

type Query = Record<string, string | number | boolean | undefined | null>;

export type OneTimeMaintenanceEjectionPermit = {
  id: string;
  stationId: string;
  slotNum: number;
  expiresAt: string;
};

// A paid staging rental can only be resumed after a human checkpoint when its
// release was previously stopped by the hardware kill switch. This permit is
// stored in the service-role-only staging database and consumed before the
// supplier request. It binds one rental, one cabinet and one slot, and can
// never operate outside ChargeNow test mode.
export type OneTimeRentalEjectionPermit = {
  id: string;
  rentalSessionId: string;
  stationId: string;
  slotNum: number;
  expiresAt: string;
};

export function oneTimeMaintenanceEjectionPermit(): OneTimeMaintenanceEjectionPermit | null {
  try {
    const parsed = JSON.parse(Deno.env.get("CHARGENOW_ONE_TIME_MAINTENANCE_EJECTION_PERMIT") ?? "") as Partial<OneTimeMaintenanceEjectionPermit>;
    if (typeof parsed.id !== "string" || typeof parsed.stationId !== "string" || !Number.isInteger(parsed.slotNum)
      || typeof parsed.expiresAt !== "string" || Number.isNaN(Date.parse(parsed.expiresAt))) return null;
    return parsed as OneTimeMaintenanceEjectionPermit;
  } catch {
    return null;
  }
}

async function request<T = unknown>(
  method: string,
  path: string,
  opts: { query?: Query; body?: unknown; bearer?: string; mutation?: boolean; oneTimeMaintenanceEjection?: boolean; oneTimeRentalEjection?: boolean; superAdminMutation?: boolean } = {},
): Promise<ApiResult<T>> {
  if (!isChargeNowConfigured() && !opts.bearer) {
    return { ok: false, status: 0, data: null, error: "CHARGENOW_NOT_CONFIGURED" };
  }
  if (opts.mutation && !areChargeNowMutationsEnabled() && !opts.oneTimeMaintenanceEjection && !opts.oneTimeRentalEjection) {
    return { ok: false, status: 0, data: null, error: "CHARGENOW_MUTATIONS_DISABLED" };
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
      signal: AbortSignal.timeout(TIMEOUT_MS),
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

// An alternate POST variant has been observed in supplier material, but is not
// enabled here. Chargeurs.ch only calls the explicitly approved documented
// staging operation on CHARGENOW_API_BASE_URL. The coverage UI keeps O7 as
// PROVIDER_ENDPOINT_MISSING until ChargeNow confirms an official contract.

// O2 — Create Rent Order (query params: deviceId, callbackURL)
export const orderCreate = (args: { deviceId: string; callbackURL?: string }, context: SuperAdminMutationContext = {}) =>
  request("POST", "/rent/order/create", {
    query: { deviceId: args.deviceId, callbackURL: args.callbackURL },
    mutation: true, superAdminMutation: context.superAdminConfirmed,
  });

// The same one-time permit is required for the supplier order that precedes a
// permitted rental ejection. It is deliberately not a general order-creation
// bypass: the station must match and only ChargeNow test mode is accepted.
export const orderCreateWithOneTimeRentalPermit = (
  args: { deviceId: string; callbackURL?: string },
  permit: OneTimeRentalEjectionPermit,
) => {
  if (
    chargeNowMode() !== "test" ||
    permit.stationId !== args.deviceId ||
    Date.parse(permit.expiresAt) <= Date.now()
  ) {
    return Promise.resolve<ApiResult>({ ok: false, status: 0, data: null, error: "ONE_TIME_RENTAL_EJECTION_NOT_PERMITTED" });
  }
  return request("POST", "/rent/order/create", {
    query: { deviceId: args.deviceId, callbackURL: args.callbackURL },
    mutation: true,
    oneTimeRentalEjection: true,
  });
};

// O3 — Query Rent Order Status (query: tradeNo)
export const orderQuery = (tradeNo: string) =>
  request("POST", "/rent/order/query", { query: { tradeNo } });

// O4 — Mark Order Completed / Close (query: tradeNo)
export const orderClose = (args: { tradeNo: string } | string, context: SuperAdminMutationContext = {}) => {
  const tradeNo = typeof args === "string" ? args : args.tradeNo;
  return request("POST", "/rent/order/close", { query: { tradeNo }, mutation: true, superAdminMutation: context.superAdminConfirmed });
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
}, context: SuperAdminMutationContext = {}) =>
  request("POST", "/cabinet/operation", {
    query: {
      cabinetid: args.cabinetid, slotNum: args.slotNum,
      operationType: args.operationType, reason: args.reason ?? "admin",
    },
    mutation: true, superAdminMutation: context.superAdminConfirmed,
  });
// Back-compat helper used by older callers.
export const operationPop = (cabinetid: string, slotNum: number, context: SuperAdminMutationContext = {}) =>
  cabinetOperation({ cabinetid, slotNum, operationType: "pop" }, context);

// C2 — Eject By Repair (query: cabinetid, slotNum). 0/null = eject all.
export const ejectByRepair = (cabinetid: string, slotNum: number, context: SuperAdminMutationContext = {}) =>
  request("POST", "/cabinet/ejectByRepair", { query: { cabinetid, slotNum }, mutation: true, superAdminMutation: context.superAdminConfirmed });

// The only route allowed to bypass the broad mutation flag. Its target is
// fixed by a short-lived, server-only permit; every other mutation remains
// governed by CHARGENOW_MUTATIONS_ENABLED.
export const ejectByRepairWithOneTimePermit = (cabinetid: string, slotNum: number) => {
  const permit = oneTimeMaintenanceEjectionPermit();
  if (!permit || permit.stationId !== cabinetid || permit.slotNum !== slotNum || Date.parse(permit.expiresAt) <= Date.now()) {
    return Promise.resolve<ApiResult>({ ok: false, status: 0, data: null, error: "ONE_TIME_MAINTENANCE_EJECTION_NOT_PERMITTED" });
  }
  return request("POST", "/cabinet/ejectByRepair", {
    query: { cabinetid, slotNum }, mutation: true, oneTimeMaintenanceEjection: true,
  });
};

// C3 — Eject By Rent (query: cabinetid, rentOrderId, slotNum).
// Slot 0 is ambiguous in the supplier material. It is refused unless the
// operator explicitly configures CHARGENOW_RENT_SLOT_ZERO_MODE to
// "provider_auto_select" after confirming that convention with ChargeNow.
export const ejectByRent = (
  cabinetid: string,
  slotNum: number,
  rentOrderId?: string,
  context: SuperAdminMutationContext = {},
): Promise<ApiResult> => {
  const slot = resolveRentSlot(slotNum, Deno.env.get("CHARGENOW_RENT_SLOT_ZERO_MODE"));
  if (!slot.ok) {
    return Promise.resolve({ ok: false, status: 0, data: null, error: slot.error });
  }
  return request("POST", "/cabinet/ejectByRent", {
    query: { cabinetid, rentOrderId, slotNum: slot.slotNum },
    mutation: true, superAdminMutation: context.superAdminConfirmed,
  });
};

// The permit check is repeated in eject-after-payment before this helper is
// reached. It is repeated here as a defence-in-depth check so no caller can
// use the supplier mutation bypass with a broad or expired target.
export const ejectByRentWithOneTimeRentalPermit = (
  cabinetid: string,
  slotNum: number,
  rentOrderId: string,
  rentalSessionId: string,
  permit: OneTimeRentalEjectionPermit,
): Promise<ApiResult> => {
  if (
    chargeNowMode() !== "test" ||
    permit.rentalSessionId !== rentalSessionId ||
    permit.stationId !== cabinetid ||
    permit.slotNum !== slotNum ||
    Date.parse(permit.expiresAt) <= Date.now()
  ) {
    return Promise.resolve({ ok: false, status: 0, data: null, error: "ONE_TIME_RENTAL_EJECTION_NOT_PERMITTED" });
  }
  return request("POST", "/cabinet/ejectByRent", {
    query: { cabinetid, rentOrderId, slotNum },
    mutation: true,
    oneTimeRentalEjection: true,
  });
};

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
export const bind2shop = (qrcode: string, newshopid: string, context: SuperAdminMutationContext = {}) =>
  request("POST", `/cabinet/bind2shop/${encodeURIComponent(qrcode)}/${encodeURIComponent(newshopid)}`, { mutation: true, superAdminMutation: context.superAdminConfirmed });

// C10 — Update Cabinet Advertising
export const bindAd = (body: {
  cabinetIdList: string[]; isRestart?: boolean; adConfigList: unknown[];
}, context: SuperAdminMutationContext = {}) => request("POST", "/cabinet/bindAd", { body, mutation: true, superAdminMutation: context.superAdminConfirmed });

// C11 — Unbind Device From Shop
export const unbindShop = (deviceIds: string[], context: SuperAdminMutationContext = {}) =>
  request("POST", "/cabinet/unbindShop", { body: deviceIds, mutation: true, superAdminMutation: context.superAdminConfirmed });

// C12 — Publish Advertisement
export const publishAd = (body: {
  cabinetIdList: string[]; restart?: boolean; adConfigList: unknown[];
}, context: SuperAdminMutationContext = {}) => request("POST", "/cabinet/publishAd", { body, mutation: true, superAdminMutation: context.superAdminConfirmed });

// ============================================================
// ADVANCE API — SHOP (S1-S5)
// ============================================================
// S1 — Get All Shop List
export const getShopList = () => request("GET", "/shop/getShopList");

// S2 — Get Shop Detail
export const shopDetail = (shopid: string) =>
  request("GET", `/shop/detail/${encodeURIComponent(shopid)}`);

// S3 — Create New Shop
export const shopCreate = (body: Record<string, unknown>, context: SuperAdminMutationContext = {}) =>
  request("POST", "/shop/create", { body, mutation: true, superAdminMutation: context.superAdminConfirmed });

// S4 — Update Shop
export const shopUpdate = (body: Record<string, unknown>, context: SuperAdminMutationContext = {}) =>
  request("PUT", "/shop/update", { body, mutation: true, superAdminMutation: context.superAdminConfirmed });

// S5 — Delete Shop
export const shopDelete = (shopid: string, context: SuperAdminMutationContext = {}) =>
  request("DELETE", `/shop/delete/${encodeURIComponent(shopid)}`, { mutation: true, superAdminMutation: context.superAdminConfirmed });

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
}, context: SuperAdminMutationContext = {}) => request("POST", "/shop/priceStrategy/saveOrUpdate", { body, mutation: true, superAdminMutation: context.superAdminConfirmed });

// P4 — Delete Price Strategy (body: array of priceIds)
export const priceStrategyDelete = (priceIds: number[], context: SuperAdminMutationContext = {}) =>
  request("POST", "/shop/priceStrategy/delete", { body: priceIds, mutation: true, superAdminMutation: context.superAdminConfirmed });

// P5 — Shop Bind Price Strategy
export const priceStrategyBind = (args: { shopId: string; priceId: number; customType?: number }, context: SuperAdminMutationContext = {}) =>
  request("POST", "/shop/priceStrategy/bindShop", {
    body: { shopId: args.shopId, priceId: args.priceId, customType: args.customType ?? 0 },
    mutation: true, superAdminMutation: context.superAdminConfirmed,
  });

// P6 — Shop Unbind Price Strategy
export const priceStrategyUnbind = (args: { shopId: string; customType?: number }, context: SuperAdminMutationContext = {}) =>
  request("POST", "/shop/priceStrategy/unbindShop", {
    body: { shopId: args.shopId, customType: args.customType ?? 0 },
    mutation: true, superAdminMutation: context.superAdminConfirmed,
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
export const eventPushConfig = (pushUrl: string, eventSubscriptions?: EventSubscription[], context: SuperAdminMutationContext = {}) =>
  request("POST", "/cabinet/eventPush/config", {
    body: { pushUrl, eventSubscriptions: eventSubscriptions ?? [] },
    mutation: true, superAdminMutation: context.superAdminConfirmed,
  });

// E2 — Get current event push config
export const eventPushConfigGet = () =>
  request("GET", "/cabinet/eventPush/config/get");

export const ALL_EVENT_TYPES = [
  "CABINET_ONLINE", "CABINET_OFFLINE", "CABINET_STATUS", "BATTERY_IN",
  "BATTERY_BORROW_OUT", "BATTERY_ABNORMAL_WARNING", "BATTERY_POPUP", "ADMIN_RENTAL_ORDER",
] as const;

export { BASE_URL };
