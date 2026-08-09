export type ChargeNowBattery = {
  slotNum: number | null;
  batteryId: string | null;
  powerLevel: number | null;
  raw: Record<string, unknown>;
};

export type ParsedCabinetStatus = {
  recognized: boolean;
  online: boolean | null;
  providerShopId?: string | null;
  providerShopName?: string | null;
  providerShopAddress?: string | null;
  totalCount: number | null;
  rentableCount: number;
  returnableCount: number | null;
  signal: number | null;
  batteries: ChargeNowBattery[];
  payload: Record<string, unknown>;
};

type UnknownRecord = Record<string, unknown>;

const TRUE_VALUES = new Set(["1", "true", "online", "connected", "active", "normal", "yes", "up"]);
const FALSE_VALUES = new Set(["0", "false", "offline", "disconnected", "inactive", "disabled", "no", "down"]);

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asNonNegativeInteger(value: unknown): number | null {
  const parsed = asNumber(value);
  if (parsed == null || parsed < 0) return null;
  return Math.trunc(parsed);
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return null;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (TRUE_VALUES.has(normalized)) return true;
    if (FALSE_VALUES.has(normalized)) return false;
  }
  return null;
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

function firstArray(record: UnknownRecord, keys: string[]): unknown[] | null {
  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return null;
}

export function unwrapChargeNowPayload(value: unknown): UnknownRecord {
  let current: UnknownRecord = isRecord(value) ? value : {};
  for (let depth = 0; depth < 5; depth += 1) {
    const hasStatusShape = [
      "cabinet", "device", "cabinetInfo", "deviceInfo", "batteries", "batteryList",
      "slots", "slotList", "online", "onlineStatus", "status",
    ].some((key) => current[key] !== undefined);
    if (hasStatusShape) return current;
    const next = firstRecord(current, ["data", "result", "payload"]);
    if (!next) return current;
    current = next;
  }
  return current;
}

function normalizeBattery(value: unknown): ChargeNowBattery | null {
  if (!isRecord(value)) return null;
  const slotNum = asNonNegativeInteger(firstDefined(value, ["slotNum", "slot", "slotId", "port", "portNo", "channel"]));
  const rawBatteryId = firstDefined(value, ["batteryId", "batteryID", "batterySn", "batterySN", "sn", "bid", "powerBankId"]);
  const batteryId = rawBatteryId == null || String(rawBatteryId).trim() === "" ? null : String(rawBatteryId).trim();
  // `vol`, `capacity` and `batteryCapacity` have not been confirmed as a
  // percentage in every supplier payload. Never turn a voltage (for example
  // 31.2) or a capacity into a customer-facing charge level.
  const candidate = asNumber(firstDefined(value, ["chargePercent", "charge_percent", "powerLevel", "power_level", "electricity", "soc"]));
  const powerLevel = candidate != null && candidate >= 0 && candidate <= 100 ? candidate : null;
  return { slotNum, batteryId, powerLevel, raw: value };
}

export function parseChargeNowCabinetStatus(value: unknown): ParsedCabinetStatus {
  const payload = unwrapChargeNowPayload(value);
  const cabinet = firstRecord(payload, ["cabinet", "device", "cabinetInfo", "deviceInfo"]) ?? payload;
  const shop = firstRecord(payload, ["shop", "shopInfo", "store"]);

  const onlineCandidates = [
    firstDefined(cabinet, ["online", "isOnline", "onlineStatus", "networkStatus", "connectStatus", "status"]),
    firstDefined(payload, ["online", "isOnline", "onlineStatus", "networkStatus", "connectStatus", "status"]),
  ];
  let online: boolean | null = null;
  for (const candidate of onlineCandidates) {
    online = asBoolean(candidate);
    if (online !== null) break;
  }

  const batteryArray = firstArray(payload, ["batteries", "batteryList", "powerBanks", "powerbanks"])
    ?? firstArray(cabinet, ["batteries", "batteryList", "powerBanks", "powerbanks"])
    ?? firstArray(payload, ["slots", "slotList"])
    ?? firstArray(cabinet, ["slots", "slotList"])
    ?? [];
  const batteries = batteryArray
    .map(normalizeBattery)
    .filter((item): item is ChargeNowBattery => item !== null && item.batteryId !== null);

  const totalCount = asNonNegativeInteger(firstDefined(cabinet, ["slots", "slotNum", "totalSlots", "totalSlotNum", "capacity", "slotCount"]))
    ?? asNonNegativeInteger(firstDefined(payload, ["slots", "slotNum", "totalSlots", "totalSlotNum", "capacity", "slotCount"]))
    ?? (batteryArray.length > 0 ? batteryArray.length : null);

  const providerRentable = asNonNegativeInteger(firstDefined(cabinet, ["rentableCount", "availableBatteries", "availableBatteryNum", "availableNum", "canRentNum", "busySlots"]))
    ?? asNonNegativeInteger(firstDefined(payload, ["rentableCount", "availableBatteries", "availableBatteryNum", "availableNum", "canRentNum", "busySlots"]));
  const rentableCount = providerRentable ?? batteries.length;

  const providerReturnable = asNonNegativeInteger(firstDefined(cabinet, ["emptySlots", "emptySlotNum", "returnableCount", "availableReturnSlots", "canReturnNum"]))
    ?? asNonNegativeInteger(firstDefined(payload, ["emptySlots", "emptySlotNum", "returnableCount", "availableReturnSlots", "canReturnNum"]));
  const returnableCount = providerReturnable ?? (totalCount == null ? null : Math.max(0, totalCount - rentableCount));

  const signal = asNumber(firstDefined(cabinet, ["signal", "signalStrength", "rssi"]))
    ?? asNumber(firstDefined(payload, ["signal", "signalStrength", "rssi"]));

  // Keep provider identity separate from the local partner/shop relation. The
  // provider shop can be observed safely during read-only sync and reconciled
  // later by an operator without guessing a local organisation relationship.
  const rawProviderShopId = firstDefined(cabinet, ["shopId", "shopID", "storeId"])
    ?? firstDefined(shop ?? {}, ["id", "shopId", "storeId"]);
  const providerShopId = rawProviderShopId == null || String(rawProviderShopId).trim() === ""
    ? null
    : String(rawProviderShopId).trim();
  const rawProviderShopName = firstDefined(shop ?? {}, ["name", "shopName", "storeName"]);
  const providerShopName = rawProviderShopName == null || String(rawProviderShopName).trim() === ""
    ? null
    : String(rawProviderShopName).trim();
  const rawProviderShopAddress = firstDefined(shop ?? {}, ["address", "location", "fullAddress"]);
  const providerShopAddress = rawProviderShopAddress == null || String(rawProviderShopAddress).trim() === ""
    ? null
    : String(rawProviderShopAddress).trim();

  const recognized = online !== null
    || totalCount !== null
    || providerRentable !== null
    || providerReturnable !== null
    || batteryArray.length > 0
    || signal !== null;

  return {
    recognized,
    online,
    providerShopId,
    providerShopName,
    providerShopAddress,
    totalCount,
    rentableCount,
    returnableCount,
    signal,
    batteries,
    payload,
  };
}
