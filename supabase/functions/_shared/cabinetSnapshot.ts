// Conservative, multi-source interpretation of a ChargeNow cabinet.
//
// The provider returns different payload shapes per endpoint. For the
// ChargeNow DTA integration, `vol` on the public O1 payload is the
// state-of-charge percentage (0–100). The advanced C4/C7/C8 payloads use
// provider-prefixed names such as pBatteryid, pKakou and pDianliang.
//
// IMPORTANT: temperature, capacity, check-result and voltage-looking values
// are never substituted for state of charge.
import {
  batteryListByCabinetId,
  cabinetDetail,
  cabinetQuery,
  slotByCabinetId,
  type ApiResult,
} from "./chargenow.ts";

export type SlotConfidence = "high" | "medium" | "low";
export type SlotCustomerStatus = "ready" | "recommended" | "charging" | "checking" | "unavailable" | "return_available" | "technical_issue" | "maintenance";

export type CabinetSlotSnapshot = {
  slot_num: number;
  battery_id: string | null;
  battery_present: boolean | null;
  charge_percent: number | null;
  temperature_c: number | null;
  online: boolean | null;
  health_status: string | null;
  self_check: "pass" | "fail" | "unknown";
  error_code: string | null;
  fault_type: string | null;
  fault_cause: string | null;
  rentable: boolean;
  confidence: SlotConfidence;
  customer_status: SlotCustomerStatus;
  /** Evidence-based operator diagnostics; never shown as raw supplier codes to customers. */
  diagnostic_flags: string[];
  source_timestamps: Record<string, string>;
  conflicts: string[];
  /** Age of the newest usable supplier observation for this slot. */
  data_age_seconds: number | null;
  raw: Record<string, unknown>;
};

export type CabinetSnapshot = {
  cabinet_id: string;
  online: boolean | null;
  sources: Record<string, { ok: boolean; status: number; timestamp: string }>;
  slots: CabinetSlotSnapshot[];
};

type RecordValue = Record<string, unknown>;
type SourceName = "c4_detail" | "c7_batteries" | "c8_slots" | "o1_query";
type Observation = { source: SourceName; timestamp: string; raw: RecordValue };

const DEFAULT_MIN_RENTAL_CHARGE_PERCENT = 20;

function minimumRentalChargePercent(): number {
  const configured = Number(Deno.env.get("MIN_RENTAL_BATTERY_PERCENT") ?? DEFAULT_MIN_RENTAL_CHARGE_PERCENT);
  return Number.isFinite(configured) && configured >= 1 && configured <= 100
    ? configured
    : DEFAULT_MIN_RENTAL_CHARGE_PERCENT;
}

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function first(record: RecordValue, keys: string[]): unknown {
  for (const key of keys) if (record[key] !== undefined && record[key] !== null) return record[key];
  return undefined;
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1") return true;
  if (value === 0 || value === "0") return false;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (["online", "ready", "normal", "active", "true", "yes", "up", "pass", "passed", "在线", "正常"].includes(normalized)) return true;
  if (["offline", "disabled", "false", "no", "down", "fail", "failed", "离线", "异常"].includes(normalized)) return false;
  return null;
}

/** Parse only confirmed ChargeNow state-of-charge keys. */
export function parseChargePercent(record: RecordValue): number | null {
  const value = numberValue(first(record, [
    "chargePercent", "charge_percent", "powerLevel", "power_level", "soc", "electricity", "batteryPower",
    "pDianliang", "pdianliang",
  ]));
  if (value != null) return value >= 0 && value <= 100 ? value : null;

  // O1 `vol` is the DTA percentage. Keep the integer guard so a decimal such
  // as 31.2 can never be mistaken for SOC when it is actually temperature or
  // another voltage-like diagnostic value.
  const dtaVol = numberValue(record.vol);
  return dtaVol != null && Number.isInteger(dtaVol) && dtaVol >= 0 && dtaVol <= 100
    ? dtaVol
    : null;
}

/** Only explicit temperature keys are accepted as Celsius. */
export function parseTemperatureC(record: RecordValue): number | null {
  const value = numberValue(first(record, [
    "temperatureC", "temperature_c", "temperature", "tempC", "temp_c", "temp",
    "pTemperature", "ptemperature",
  ]));
  return value != null && value >= -40 && value <= 100 ? value : null;
}

/** Diagnostics only: a voltage must never be rendered as a charge level. */
export function parseVoltage(record: RecordValue): number | null {
  const value = numberValue(first(record, ["voltage", "voltageV", "voltage_v", "batteryVoltage"]));
  return value != null && value >= 0 && value <= 1000 ? value : null;
}

export function parseSelfCheck(record: RecordValue): "pass" | "fail" | "unknown" {
  // pCheckResult is intentionally NOT interpreted here. In observed ChargeNow
  // payloads it carries values such as 96/100 and is not a documented boolean
  // pass/fail signal. Keep it available in raw diagnostics instead of inventing
  // a safety meaning.
  const value = first(record, ["selfCheck", "self_check", "selfCheckStatus", "autoCheck", "auto_check"]);
  const bool = toBoolean(value);
  if (bool === true) return "pass";
  if (bool === false) return "fail";
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (["ok", "normal", "success"].includes(text)) return "pass";
  if (["error", "abnormal", "invalid"].includes(text)) return "fail";
  return "unknown";
}

function nonBlockingZeroText(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const normalized = text.toLowerCase();
  if (["0", "0.0", "none", "normal", "ok", "false", "null"].includes(normalized)) return null;
  return text;
}

export function parseFault(record: RecordValue) {
  const rawError = first(record, ["errorCode", "error_code", "pErrId", "pErrid", "perrid", "errId", "faultCode"]);
  const faultType = first(record, ["faultType", "fault_type", "pFaultType", "pfaultType"]);
  const faultCause = first(record, ["faultCause", "fault_cause", "pFaultCause", "pfaultCause"]);
  return {
    error_code: nonBlockingZeroText(rawError),
    fault_type: nonBlockingZeroText(faultType),
    fault_cause: nonBlockingZeroText(faultCause),
  };
}

function unwrap(value: unknown): unknown {
  let current = value;
  for (let n = 0; n < 4 && isRecord(current); n += 1) {
    const next = first(current, ["data", "result", "payload"]);
    if (!isRecord(next) && !Array.isArray(next)) return current;
    current = next;
  }
  return current;
}

function collectRecords(value: unknown, depth = 0): RecordValue[] {
  if (depth > 5) return [];
  if (Array.isArray(value)) return value.flatMap((item) => collectRecords(item, depth + 1));
  if (!isRecord(value)) return [];
  const directSlot = parseSlotNum(value);
  const directBattery = parseBatteryId(value);
  const own = directSlot != null || directBattery != null ? [value] : [];

  // C4 puts the current per-slot records in cabinet.batcabs. We deliberately
  // do NOT recurse into subDeviceStatusReport: its B-fields are a lower-level
  // heartbeat that can lag behind the current C4/C7/C8/O1 battery values and
  // would create false SOC conflicts.
  const nested = Object.entries(value)
    .filter(([key, nestedValue]) => /^(cabinet|device|cabinetInfo|deviceInfo|batcabs|list|rows|records|slots|slotList|batteries|batteryList|items)$/i.test(key)
      && (Array.isArray(nestedValue) || isRecord(nestedValue)))
    .flatMap(([, nestedValue]) => collectRecords(nestedValue, depth + 1));
  return [...own, ...nested];
}

function parseSlotNum(record: RecordValue): number | null {
  const value = numberValue(first(record, [
    "slotNum", "slot_num", "slot", "slotNo", "slotId", "port", "portNo", "channel",
    "pKakou", "pkakou", "pSubKakou", "psubKakou",
  ]));
  return value != null && Number.isInteger(value) && value >= 1 && value <= 128 ? value : null;
}

function parseBatteryId(record: RecordValue): string | null {
  const value = first(record, [
    "batteryId", "batteryID", "batterySn", "batterySN", "battery_id", "sn", "bid", "powerBankId",
    "pBatteryid", "pbatteryid",
  ]);
  return value == null || String(value).trim() === "" ? null : String(value).trim();
}

function sourceOnline(record: RecordValue): boolean | null {
  return toBoolean(first(record, [
    "online", "isOnline", "onlineStatus", "networkStatus", "connectStatus",
    "pInfostatus", "pinfostatus",
  ]));
}

function sourcePresent(record: RecordValue): boolean | null {
  const explicit = toBoolean(first(record, ["batteryPresent", "battery_present", "present", "isPresent", "hasBattery"]));
  if (explicit !== null) return explicit;
  if (parseBatteryId(record)) return true;

  // C8 may describe every physical compartment, including an empty one. A
  // null/blank CURRENT battery identifier is evidence of an empty return slot.
  // pLastBatteryid must never be used for presence.
  const batteryKeys = [
    "batteryId", "batteryID", "batterySn", "batterySN", "battery_id", "sn", "bid", "powerBankId",
    "pBatteryid", "pbatteryid",
  ];
  const emptyBatteryKey = batteryKeys.find((key) => Object.prototype.hasOwnProperty.call(record, key)
    && (record[key] === null || record[key] === undefined || String(record[key]).trim() === ""));
  if (emptyBatteryKey) return false;

  const slotState = first(record, ["slotStatus", "slot_status", "slotState", "slot_state", "compartmentStatus"]);
  if (typeof slotState === "string" && ["empty", "vacant", "free", "available", "returnable"].includes(slotState.trim().toLowerCase())) return false;
  return null;
}

function sourceHealth(record: RecordValue): string | null {
  const value = first(record, ["healthStatus", "health_status", "batteryStatus", "status"]);
  if (value != null && String(value).trim() !== "") return String(value).trim().toLowerCase();
  // Capacity/check-result values remain diagnostics only. Do not translate a
  // 96 or 100 into "healthy" without a documented provider contract.
  return null;
}

function sourceMayEject(record: RecordValue): boolean | null {
  return toBoolean(first(record, ["rentable", "canRent", "canEject", "ejectable", "available"]));
}

function latest<T>(values: Array<{ value: T; timestamp: string }>): T | null {
  if (!values.length) return null;
  return values.sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0].value;
}

/** Keep the newest actual observation; missing fields never erase known data. */
function latestKnown<T>(values: Array<{ value: T | null; timestamp: string }>): T | null {
  return latest(values.filter((item): item is { value: T; timestamp: string } => item.value !== null));
}

function conflicting<T>(values: T[]): boolean {
  return new Set(values.filter((value) => value !== null && value !== undefined).map(String)).size > 1;
}

export function mergeCabinetSlotObservations(observations: Observation[], totalSlots = 4): CabinetSlotSnapshot[] {
  const perSlot = new Map<number, Observation[]>();
  for (const observation of observations) {
    for (const raw of collectRecords(unwrap(observation.raw))) {
      const slot = parseSlotNum(raw);
      if (slot == null) continue;
      const list = perSlot.get(slot) ?? [];
      list.push({ ...observation, raw });
      perSlot.set(slot, list);
    }
  }

  const maxSlot = Math.max(totalSlots, ...perSlot.keys(), 0);
  return Array.from({ length: maxSlot }, (_, index) => {
    const slotNum = index + 1;
    const slotObservations = perSlot.get(slotNum) ?? [];
    const timestamps = Object.fromEntries(slotObservations.map((item) => [item.source, item.timestamp]));
    const batteryValues = slotObservations.map((item) => parseBatteryId(item.raw)).filter((value): value is string => Boolean(value));
    const chargeValues = slotObservations.map((item) => parseChargePercent(item.raw)).filter((value): value is number => value != null);
    const presentValues = slotObservations.map((item) => sourcePresent(item.raw)).filter((value): value is boolean => value != null);
    const onlineValues = slotObservations.map((item) => sourceOnline(item.raw)).filter((value): value is boolean => value != null);
    const ejectableValues = slotObservations.map((item) => sourceMayEject(item.raw)).filter((value): value is boolean => value != null);
    const checks = slotObservations.map((item) => parseSelfCheck(item.raw));
    const faults = slotObservations.map((item) => parseFault(item.raw));
    const error = faults.find((fault) => fault.error_code)?.error_code ?? null;
    const faultType = faults.find((fault) => fault.fault_type)?.fault_type ?? null;
    const faultCause = faults.find((fault) => fault.fault_cause)?.fault_cause ?? null;

    const conflicts: string[] = [];
    if (conflicting(batteryValues)) conflicts.push("battery_id");
    if (conflicting(chargeValues)) conflicts.push("charge_percent");
    if (conflicting(presentValues)) conflicts.push("battery_present");
    if (conflicting(onlineValues)) conflicts.push("online");

    const batteryId = latestKnown(slotObservations.map((item) => ({ value: parseBatteryId(item.raw), timestamp: item.timestamp })));
    const batteryPresent = latestKnown(slotObservations.map((item) => ({ value: sourcePresent(item.raw), timestamp: item.timestamp })));
    const chargePercent = latestKnown(slotObservations.map((item) => ({ value: parseChargePercent(item.raw), timestamp: item.timestamp })));
    const temperatureC = latestKnown(slotObservations.map((item) => ({ value: parseTemperatureC(item.raw), timestamp: item.timestamp })));
    const online = latestKnown(slotObservations.map((item) => ({ value: sourceOnline(item.raw), timestamp: item.timestamp })));
    const healthStatus = latestKnown(slotObservations.map((item) => ({ value: sourceHealth(item.raw), timestamp: item.timestamp })));
    const selfCheck = checks.includes("fail") ? "fail" : checks.includes("pass") ? "pass" : "unknown";

    const blocking = Boolean(error || faultType || faultCause)
      || selfCheck === "fail"
      || online === false
      || (temperatureC != null && (temperatureC < 0 || temperatureC > 55))
      || conflicts.length > 0;
    const supplierEjectable = ejectableValues.includes(false) ? false : ejectableValues.includes(true) ? true : null;
    const freshEnough = slotObservations.some((item) => Date.now() - Date.parse(item.timestamp) < 5 * 60 * 1000);
    const newestTimestamp = slotObservations.map((item) => item.timestamp).sort().at(-1) ?? null;
    const dataAgeSeconds = newestTimestamp
      ? Math.max(0, Math.floor((Date.now() - Date.parse(newestTimestamp)) / 1000))
      : null;
    const confidence: SlotConfidence = conflicts.length
      ? "low"
      : slotObservations.length >= 2 && batteryId && freshEnough
      ? "high"
      : "medium";

    const hasConfirmedCharge = chargePercent !== null;
    const minCharge = minimumRentalChargePercent();
    const hasUsableCharge = chargePercent != null && chargePercent >= minCharge;
    const diagnosticFlags: string[] = [];
    const confirmedEmpty = batteryPresent === false;
    const confirmedZeroBattery = Boolean(
      batteryPresent === true && chargePercent === 0 && freshEnough && !conflicts.includes("charge_percent"),
    );
    if (confirmedZeroBattery) diagnosticFlags.push("zero_charge_reported");
    if (chargePercent != null && chargePercent > 0 && chargePercent < minCharge) diagnosticFlags.push("charge_below_rental_threshold");

    const rentable = Boolean(
      batteryId && batteryPresent !== false && online !== false && !blocking
      && freshEnough && confidence !== "low" && supplierEjectable !== false
      && hasConfirmedCharge && hasUsableCharge,
    );

    const customerStatus: SlotCustomerStatus = confirmedEmpty ? "return_available"
      : confirmedZeroBattery ? "technical_issue"
      : conflicts.length || confidence === "low" || batteryPresent === null || !hasConfirmedCharge ? "checking"
      : rentable ? "ready"
      : blocking ? "maintenance"
      : !batteryId ? "unavailable"
      : "charging";

    return {
      slot_num: slotNum,
      battery_id: batteryId,
      battery_present: batteryPresent,
      charge_percent: chargePercent,
      temperature_c: temperatureC,
      online,
      health_status: healthStatus,
      self_check: selfCheck,
      error_code: error,
      fault_type: faultType,
      fault_cause: faultCause,
      rentable,
      confidence,
      customer_status: customerStatus,
      diagnostic_flags: diagnosticFlags,
      source_timestamps: timestamps,
      conflicts,
      data_age_seconds: dataAgeSeconds,
      raw: Object.assign({}, ...slotObservations.map((item) => item.raw)),
    };
  });
}

function sourceMeta(result: ApiResult, timestamp: string) {
  return { ok: result.ok, status: result.status, timestamp };
}

export async function readCabinetSnapshot(cabinetId: string): Promise<CabinetSnapshot> {
  const timestamp = new Date().toISOString();
  const [c4, c7, c8, o1] = await Promise.all([
    cabinetDetail(cabinetId),
    batteryListByCabinetId(cabinetId),
    slotByCabinetId(cabinetId),
    cabinetQuery(cabinetId),
  ]);
  const results: Array<[SourceName, ApiResult]> = [
    ["c4_detail", c4],
    ["c7_batteries", c7],
    ["c8_slots", c8],
    ["o1_query", o1],
  ];
  const observations: Observation[] = results
    .filter(([, result]) => result.ok && isRecord(result.data))
    .map(([source, result]) => ({ source, timestamp, raw: result.data as RecordValue }));
  const rootOnline = latest(observations.map((item) => ({
    value: sourceOnline(unwrap(item.raw) as RecordValue),
    timestamp: item.timestamp,
  })));
  return {
    cabinet_id: cabinetId,
    online: rootOnline,
    sources: Object.fromEntries(results.map(([source, result]) => [source, sourceMeta(result, timestamp)])),
    slots: mergeCabinetSlotObservations(observations),
  };
}
