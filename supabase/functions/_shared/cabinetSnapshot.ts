// Conservative, multi-source interpretation of a ChargeNow cabinet.
//
// The provider returns different payload shapes per endpoint. For the
// ChargeNow DTA integration, the operator has confirmed that `vol` is the
// state-of-charge percentage (0–100), not a voltage. `capacity` and generic
// temperature-looking values remain deliberately excluded.
import {
  batteryListByCabinetId,
  cabinetDetail,
  cabinetQuery,
  slotByCabinetId,
  type ApiResult,
} from "./chargenow.ts";

export type SlotConfidence = "high" | "medium" | "low";
export type SlotCustomerStatus = "ready" | "recommended" | "charging" | "checking" | "unavailable" | "maintenance";

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
  source_timestamps: Record<string, string>;
  conflicts: string[];
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
  if (["online", "ready", "normal", "active", "true", "yes", "pass", "passed"].includes(normalized)) return true;
  if (["offline", "disabled", "false", "no", "fail", "failed"].includes(normalized)) return false;
  return null;
}

/**
 * Parse only confirmed ChargeNow state-of-charge keys.
 *
 * `vol` is intentionally accepted for the DTA integration after on-device
 * operator confirmation. The range guard prevents a voltage such as 3120 or
 * an unrelated capacity figure from reaching the customer UI.
 */
export function parseChargePercent(record: RecordValue): number | null {
  const value = numberValue(first(record, [
    "chargePercent", "charge_percent", "powerLevel", "power_level", "soc", "electricity", "batteryPower",
  ]));
  if (value != null) return value >= 0 && value <= 100 ? value : null;

  // `vol` is a DTA percentage by operator-confirmed vendor semantics. DTA
  // percentage snapshots are integral; do not accept a decimal here, because
  // 31.2 is also a common temperature/voltage-looking value in supplier data.
  const dtaVol = numberValue(record.vol);
  return dtaVol != null && Number.isInteger(dtaVol) && dtaVol >= 0 && dtaVol <= 100
    ? dtaVol
    : null;
}

/** Only explicit temperature keys are accepted as Celsius. */
export function parseTemperatureC(record: RecordValue): number | null {
  const value = numberValue(first(record, ["temperatureC", "temperature_c", "temperature", "tempC", "temp_c", "temp"]));
  return value != null && value >= -40 && value <= 100 ? value : null;
}

export function parseSelfCheck(record: RecordValue): "pass" | "fail" | "unknown" {
  const value = first(record, ["selfCheck", "self_check", "selfCheckStatus", "autoCheck", "auto_check"]);
  const bool = toBoolean(value);
  if (bool === true) return "pass";
  if (bool === false) return "fail";
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (["ok", "normal", "success"].includes(text)) return "pass";
  if (["error", "abnormal", "invalid"].includes(text)) return "fail";
  return "unknown";
}

export function parseFault(record: RecordValue) {
  const rawError = first(record, ["errorCode", "error_code", "pErrId", "errId", "faultCode"]);
  const faultType = first(record, ["faultType", "fault_type", "pFaultType"]);
  const faultCause = first(record, ["faultCause", "fault_cause", "pFaultCause"]);
  const asText = (value: unknown) => value == null || String(value).trim() === "" ? null : String(value).trim();
  return { error_code: asText(rawError), fault_type: asText(faultType), fault_cause: asText(faultCause) };
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
  if (depth > 4) return [];
  if (Array.isArray(value)) return value.flatMap((item) => collectRecords(item, depth + 1));
  if (!isRecord(value)) return [];
  const directSlot = parseSlotNum(value);
  const directBattery = parseBatteryId(value);
  const own = directSlot != null || directBattery != null ? [value] : [];
  const nested = Object.entries(value)
    .filter(([key, nestedValue]) => /^(list|rows|records|slots|slotList|batteries|batteryList|items)$/i.test(key) && (Array.isArray(nestedValue) || isRecord(nestedValue)))
    .flatMap(([, nestedValue]) => collectRecords(nestedValue, depth + 1));
  return [...own, ...nested];
}

function parseSlotNum(record: RecordValue): number | null {
  const value = numberValue(first(record, ["slotNum", "slot_num", "slot", "slotNo", "slotId", "port", "portNo", "channel"]));
  return value != null && Number.isInteger(value) && value >= 1 && value <= 128 ? value : null;
}

function parseBatteryId(record: RecordValue): string | null {
  const value = first(record, ["batteryId", "batteryID", "batterySn", "batterySN", "battery_id", "sn", "bid", "powerBankId"]);
  return value == null || String(value).trim() === "" ? null : String(value).trim();
}

function sourceOnline(record: RecordValue): boolean | null {
  return toBoolean(first(record, ["online", "isOnline", "onlineStatus", "networkStatus", "connectStatus"]));
}

function sourcePresent(record: RecordValue): boolean | null {
  const explicit = toBoolean(first(record, ["batteryPresent", "battery_present", "present", "isPresent", "hasBattery"]));
  return explicit ?? (parseBatteryId(record) ? true : null);
}

function sourceHealth(record: RecordValue): string | null {
  const value = first(record, ["healthStatus", "health_status", "batteryStatus", "status"]);
  return value == null || String(value).trim() === "" ? null : String(value).trim().toLowerCase();
}

function sourceMayEject(record: RecordValue): boolean | null {
  return toBoolean(first(record, ["rentable", "canRent", "canEject", "ejectable", "available"]));
}

function latest<T>(values: Array<{ value: T; timestamp: string }>): T | null {
  if (!values.length) return null;
  return values.sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0].value;
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
    const temperatureValues = slotObservations.map((item) => parseTemperatureC(item.raw)).filter((value): value is number => value != null);
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
    const batteryId = latest(slotObservations.map((item) => ({ value: parseBatteryId(item.raw), timestamp: item.timestamp })));
    const batteryPresent = latest(slotObservations.map((item) => ({ value: sourcePresent(item.raw), timestamp: item.timestamp })));
    const chargePercent = latest(slotObservations.map((item) => ({ value: parseChargePercent(item.raw), timestamp: item.timestamp })));
    const temperatureC = latest(slotObservations.map((item) => ({ value: parseTemperatureC(item.raw), timestamp: item.timestamp })));
    const online = latest(slotObservations.map((item) => ({ value: sourceOnline(item.raw), timestamp: item.timestamp })));
    const healthStatus = latest(slotObservations.map((item) => ({ value: sourceHealth(item.raw), timestamp: item.timestamp })));
    const selfCheck = checks.includes("fail") ? "fail" : checks.includes("pass") ? "pass" : "unknown";
    const blocking = Boolean(error || faultType || faultCause) || selfCheck === "fail" || online === false
      || temperatureC != null && (temperatureC < 0 || temperatureC > 55) || conflicts.length > 0;
    const supplierEjectable = ejectableValues.includes(false) ? false : ejectableValues.includes(true) ? true : null;
    const freshEnough = slotObservations.some((item) => Date.now() - Date.parse(item.timestamp) < 5 * 60 * 1000);
    const confidence: SlotConfidence = conflicts.length ? "low" : slotObservations.length >= 2 && batteryId && freshEnough ? "high" : "medium";
    // A cabinet can be online and report an occupied slot without exposing a
    // semantically trustworthy state of charge. That is not enough to call a
    // battery "ready" to a customer. For the DTA integration, `vol` is now a
    // confirmed charge field; capacity and temperature remain excluded.
    const hasConfirmedCharge = chargePercent !== null;
    const rentable = Boolean(
      batteryId && batteryPresent !== false && online !== false && !blocking &&
      freshEnough && confidence !== "low" && supplierEjectable !== false && hasConfirmedCharge,
    );
    const customerStatus: SlotCustomerStatus = !hasConfirmedCharge || conflicts.length || confidence === "low" || batteryPresent === null ? "checking"
      : rentable ? "ready"
      : blocking ? "maintenance"
      : batteryPresent === false || !batteryId ? "unavailable"
      : "charging";
    return {
      slot_num: slotNum, battery_id: batteryId, battery_present: batteryPresent, charge_percent: chargePercent,
      temperature_c: temperatureC, online, health_status: healthStatus, self_check: selfCheck,
      error_code: error, fault_type: faultType, fault_cause: faultCause, rentable, confidence, customer_status: customerStatus,
      source_timestamps: timestamps, conflicts, raw: Object.assign({}, ...slotObservations.map((item) => item.raw)),
    };
  });
}

function sourceMeta(result: ApiResult, timestamp: string) {
  return { ok: result.ok, status: result.status, timestamp };
}

export async function readCabinetSnapshot(cabinetId: string): Promise<CabinetSnapshot> {
  const timestamp = new Date().toISOString();
  const [c4, c7, c8, o1] = await Promise.all([
    cabinetDetail(cabinetId), batteryListByCabinetId(cabinetId), slotByCabinetId(cabinetId), cabinetQuery(cabinetId),
  ]);
  const results: Array<[SourceName, ApiResult]> = [["c4_detail", c4], ["c7_batteries", c7], ["c8_slots", c8], ["o1_query", o1]];
  const observations: Observation[] = results
    .filter(([, result]) => result.ok && isRecord(result.data))
    .map(([source, result]) => ({ source, timestamp, raw: result.data as RecordValue }));
  const rootOnline = latest(observations.map((item) => ({ value: sourceOnline(unwrap(item.raw) as RecordValue), timestamp: item.timestamp })));
  return {
    cabinet_id: cabinetId,
    online: rootOnline,
    sources: Object.fromEntries(results.map(([source, result]) => [source, sourceMeta(result, timestamp)])),
    slots: mergeCabinetSlotObservations(observations),
  };
}
