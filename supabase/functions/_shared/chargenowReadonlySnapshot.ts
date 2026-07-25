import {
  batteryListByCabinetId,
  cabinetDetail,
  cabinetQuery,
  priceStrategyDetail,
  shopDetail,
  slotByCabinetId,
  type ApiResult,
} from "./chargenow.ts";
import { parseChargeNowCabinetStatus } from "./chargenowStatus.ts";

type UnknownRecord = Record<string, unknown>;

export type ProviderAttempt = {
  source: string;
  endpoint: string;
  method: "GET" | "POST";
  result: ApiResult;
};

export type ProviderStationSnapshot = {
  stationId: string;
  cabinetId: string;
  collectedAt: string;
  providerReachable: boolean;
  stateKnown: boolean;
  online: boolean | null;
  signal: number | null;
  totalSlots: number | null;
  rentableCount: number;
  returnableCount: number | null;
  shop: {
    id: string | null;
    name: string | null;
    address: string | null;
    latitude: string | null;
    longitude: string | null;
  };
  pricing: {
    id: string | null;
    name: string | null;
    currency: string | null;
    depositAmount: number | null;
    price: number | null;
    priceMinute: number | null;
    freeMinutes: number | null;
    dailyMaxPrice: number | null;
    timeoutAmount: number | null;
    timeoutDay: number | null;
  };
  batteries: Array<{
    batteryId: string;
    slotNum: number | null;
    powerLevel: number | null;
  }>;
  slots: Array<{
    slotNum: number;
    status: string | null;
    batteryId: string | null;
  }>;
  attempts: Array<{
    source: string;
    endpoint: string;
    method: "GET" | "POST";
    status: number;
    ok: boolean;
    businessCode: string | number | null;
    error: string | null;
  }>;
};

export type ProviderSnapshotCollection = {
  snapshot: ProviderStationSnapshot;
  rawAttempts: ProviderAttempt[];
};

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized === "" ? null : normalized;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asInteger(value: unknown): number | null {
  const parsed = asNumber(value);
  return parsed === null ? null : Math.trunc(parsed);
}

function firstDefined(record: UnknownRecord, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

function firstRecord(record: UnknownRecord, keys: string[]): UnknownRecord | null {
  for (const key of keys) {
    if (isRecord(record[key])) return record[key] as UnknownRecord;
  }
  return null;
}

function firstArray(record: UnknownRecord, keys: string[]): unknown[] {
  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return [];
}

function unwrap(value: unknown): UnknownRecord {
  let current = isRecord(value) ? value : {};
  for (let depth = 0; depth < 5; depth += 1) {
    const next = firstRecord(current, ["data", "result", "payload"]);
    if (!next) return current;
    const hasUsefulShape = [
      "cabinet", "device", "shop", "priceStrategy", "batteries", "batteryList",
      "slots", "slotList", "shopName", "priceId", "depositAmount",
    ].some((key) => current[key] !== undefined);
    if (hasUsefulShape) return current;
    current = next;
  }
  return current;
}

function businessCode(value: unknown): string | number | null {
  if (!isRecord(value) || value.code === undefined || value.code === null) return null;
  return typeof value.code === "string" || typeof value.code === "number" ? value.code : null;
}

function effectiveSuccess(result: ApiResult): boolean {
  if (result.ok) return true;
  const code = businessCode(result.data);
  return result.status >= 200 && result.status < 300 && String(code ?? "").trim() === "0";
}

export function normalizeShop(value: unknown): ProviderStationSnapshot["shop"] {
  const payload = unwrap(value);
  const shop = firstRecord(payload, ["shop", "merchant", "venue"]) ?? payload;
  return {
    id: asString(firstDefined(shop, ["id", "shopId", "merchantId", "venueId"])),
    name: asString(firstDefined(shop, ["name", "shopName", "merchantName", "venueName"])),
    address: asString(firstDefined(shop, ["address", "shopAddress", "merchantAddress"])),
    latitude: asString(firstDefined(shop, ["latitude", "lat"])),
    longitude: asString(firstDefined(shop, ["longitude", "lng", "lon"])),
  };
}

export function normalizePricing(value: unknown): ProviderStationSnapshot["pricing"] {
  const payload = unwrap(value);
  const pricing = firstRecord(payload, ["priceStrategy", "price", "pricing", "strategy"]) ?? payload;
  return {
    id: asString(firstDefined(pricing, ["priceId", "id", "strategyId"])),
    name: asString(firstDefined(pricing, ["name", "priceName", "strategyName"])),
    currency: asString(firstDefined(pricing, ["currency", "currencyCode", "currencySymbol"])),
    depositAmount: asNumber(firstDefined(pricing, ["depositAmount", "deposit"])),
    price: asNumber(firstDefined(pricing, ["price", "unitPrice"])),
    priceMinute: asNumber(firstDefined(pricing, ["priceMinute", "priceTime", "billingMinutes", "chargeUnit"])),
    freeMinutes: asNumber(firstDefined(pricing, ["freeMinutes", "freeDuration"])),
    dailyMaxPrice: asNumber(firstDefined(pricing, ["dailyMaxPrice", "dailyCapAmount"])),
    timeoutAmount: asNumber(firstDefined(pricing, ["timeoutAmount", "overtimeAmount"])),
    timeoutDay: asNumber(firstDefined(pricing, ["timeoutDay", "overtimeDays"])),
  };
}

export function normalizeSupplementalBatteries(value: unknown): ProviderStationSnapshot["batteries"] {
  const payload = unwrap(value);
  const list = Array.isArray(value)
    ? value
    : firstArray(payload, ["batteries", "batteryList", "records", "list", "rows"]);
  const seen = new Set<string>();
  const result: ProviderStationSnapshot["batteries"] = [];
  for (const item of list) {
    if (!isRecord(item)) continue;
    const batteryId = asString(firstDefined(item, ["batteryId", "batteryID", "batterySn", "batterySN", "sn", "powerBankId"]));
    if (!batteryId || seen.has(batteryId)) continue;
    seen.add(batteryId);
    result.push({
      batteryId,
      slotNum: asInteger(firstDefined(item, ["slotNum", "slot", "slotId", "port", "channel"])),
      powerLevel: asNumber(firstDefined(item, ["vol", "capacity", "batteryCapacity", "power", "electricity", "soc"])),
    });
  }
  return result;
}

export function normalizeSlots(value: unknown): ProviderStationSnapshot["slots"] {
  const payload = unwrap(value);
  const list = Array.isArray(value)
    ? value
    : firstArray(payload, ["slots", "slotList", "records", "list", "rows"]);
  const result: ProviderStationSnapshot["slots"] = [];
  for (const item of list) {
    if (!isRecord(item)) continue;
    const slotNum = asInteger(firstDefined(item, ["slotNum", "slot", "slotId", "port", "channel"]));
    if (slotNum === null || slotNum < 0) continue;
    result.push({
      slotNum,
      status: asString(firstDefined(item, ["status", "slotStatus", "state"])),
      batteryId: asString(firstDefined(item, ["batteryId", "batteryID", "batterySn", "batterySN", "sn", "powerBankId"])),
    });
  }
  return result.sort((a, b) => a.slotNum - b.slotNum);
}

function mergeShop(
  preferred: ProviderStationSnapshot["shop"],
  fallback: ProviderStationSnapshot["shop"],
): ProviderStationSnapshot["shop"] {
  return {
    id: preferred.id ?? fallback.id,
    name: preferred.name ?? fallback.name,
    address: preferred.address ?? fallback.address,
    latitude: preferred.latitude ?? fallback.latitude,
    longitude: preferred.longitude ?? fallback.longitude,
  };
}

function mergePricing(
  preferred: ProviderStationSnapshot["pricing"],
  fallback: ProviderStationSnapshot["pricing"],
): ProviderStationSnapshot["pricing"] {
  return {
    id: preferred.id ?? fallback.id,
    name: preferred.name ?? fallback.name,
    currency: preferred.currency ?? fallback.currency,
    depositAmount: preferred.depositAmount ?? fallback.depositAmount,
    price: preferred.price ?? fallback.price,
    priceMinute: preferred.priceMinute ?? fallback.priceMinute,
    freeMinutes: preferred.freeMinutes ?? fallback.freeMinutes,
    dailyMaxPrice: preferred.dailyMaxPrice ?? fallback.dailyMaxPrice,
    timeoutAmount: preferred.timeoutAmount ?? fallback.timeoutAmount,
    timeoutDay: preferred.timeoutDay ?? fallback.timeoutDay,
  };
}

function summarizeAttempts(attempts: ProviderAttempt[]): ProviderStationSnapshot["attempts"] {
  return attempts.map((attempt) => ({
    source: attempt.source,
    endpoint: attempt.endpoint,
    method: attempt.method,
    status: attempt.result.status,
    ok: effectiveSuccess(attempt.result),
    businessCode: businessCode(attempt.result.data),
    error: attempt.result.error,
  }));
}

export async function collectChargeNowReadonlySnapshot(
  stationId: string,
  cabinetId: string,
): Promise<ProviderSnapshotCollection> {
  const rawAttempts: ProviderAttempt[] = [];

  const [coreResult, detailResult, batteriesResult, slotsResult] = await Promise.all([
    cabinetQuery(cabinetId),
    cabinetDetail(cabinetId),
    batteryListByCabinetId(cabinetId),
    slotByCabinetId(cabinetId),
  ]);

  rawAttempts.push(
    { source: "core", endpoint: "/rent/cabinet/query", method: "GET", result: coreResult },
    { source: "cabinet_detail", endpoint: `/cabinet/detail/${cabinetId}`, method: "GET", result: detailResult },
    { source: "battery_list", endpoint: `/cabinet/batteryListByCabinetId/${cabinetId}`, method: "GET", result: batteriesResult },
    { source: "slot_list", endpoint: `/cabinet/slotByCabinetId/${cabinetId}`, method: "GET", result: slotsResult },
  );

  const coreParsed = parseChargeNowCabinetStatus(coreResult.data);
  const detailParsed = parseChargeNowCabinetStatus(detailResult.data);
  const corePayload = unwrap(coreResult.data);
  const coreCabinet = firstRecord(corePayload, ["cabinet", "device", "cabinetInfo", "deviceInfo"]);

  let shop = normalizeShop(coreResult.data);
  let pricing = normalizePricing(coreResult.data);
  const shopId = shop.id ?? asString(firstDefined(coreCabinet ?? {}, ["shopId", "merchantId", "venueId"]));
  const priceId = pricing.id ?? asString(firstDefined(corePayload, ["priceId", "strategyId"]));

  if (shopId) {
    const result = await shopDetail(shopId);
    rawAttempts.push({ source: "shop_detail", endpoint: `/shop/detail/${shopId}`, method: "GET", result });
    if (effectiveSuccess(result)) shop = mergeShop(normalizeShop(result.data), shop);
  }

  if (priceId) {
    const result = await priceStrategyDetail(priceId);
    rawAttempts.push({
      source: "price_strategy_detail",
      endpoint: `/shop/priceStrategy/detail/${priceId}`,
      method: "GET",
      result,
    });
    if (effectiveSuccess(result)) pricing = mergePricing(normalizePricing(result.data), pricing);
  }

  const supplementalBatteries = normalizeSupplementalBatteries(batteriesResult.data);
  const parsedBatteries = coreParsed.batteries.length > 0 ? coreParsed.batteries : detailParsed.batteries;
  const batteries = parsedBatteries.length > 0
    ? parsedBatteries.map((battery) => ({
      batteryId: battery.batteryId!,
      slotNum: battery.slotNum,
      powerLevel: battery.powerLevel,
    }))
    : supplementalBatteries;
  const slots = normalizeSlots(slotsResult.data);

  const online = coreParsed.online ?? detailParsed.online;
  const totalSlots = coreParsed.totalCount ?? detailParsed.totalCount ?? (slots.length > 0 ? slots.length : null);
  const rentableCount = coreParsed.recognized
    ? coreParsed.rentableCount
    : detailParsed.recognized
    ? detailParsed.rentableCount
    : batteries.length;
  const returnableCount = coreParsed.returnableCount
    ?? detailParsed.returnableCount
    ?? (totalSlots === null ? null : Math.max(0, totalSlots - rentableCount));
  const stateKnown = coreParsed.recognized
    || detailParsed.recognized
    || batteries.length > 0
    || slots.length > 0;

  return {
    rawAttempts,
    snapshot: {
      stationId,
      cabinetId,
      collectedAt: new Date().toISOString(),
      providerReachable: rawAttempts.some((attempt) => attempt.result.status > 0),
      stateKnown,
      online,
      signal: coreParsed.signal ?? detailParsed.signal,
      totalSlots,
      rentableCount,
      returnableCount,
      shop,
      pricing,
      batteries,
      slots,
      attempts: summarizeAttempts(rawAttempts),
    },
  };
}
