// Conservative multi-source interpretation of a ChargeNow cabinet.
//
// ChargeNow exposes the same physical slot through several endpoint families
// with different field names. This module normalizes only semantics that have
// been observed and verified for the DTA integration. Ambiguous provider fields
// remain diagnostics; they are never promoted into customer-facing state.
import {
  batteryListByCabinetId,
  cabinetDetail,
  cabinetQuery,
  slotByCabinetId,
  type ApiResult,
} from "./chargenow.ts";

export type SlotConfidence = "high" | "medium" | "low";
export type SlotCustomerStatus =
  | "ready"
  | "recommended"
  | "charging"
  | "checking"
  | "unavailable"
  | "return_available"
  | "technical_issue"
  | "maintenance";

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
  diagnostic_flags: string[];
  source_timestamps: Record<string, string>;
  conflicts: string[];
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
const SOC_CONFLICT_TOLERANCE_PERCENT = 5;

export function minimumRentalChargePercent(): number {
  const configured = Number(
    Deno.env.get("MIN_RENTAL_BATTERY_PERCENT") ?? DEFAULT_MIN_RENTAL_CHARGE_PERCENT,
  );
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
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1") return true;
  if (value === 0 || value === "0") return false;
  if (typeof value !== "string") return null;

  const normalized = value.trim().toLowerCase();
  if ([
    "online", "ready", "normal", "active", "true", "yes", "up",
    "pass", "passed", "在线", "正常",
  ].includes(normalized)) return true;
  if ([
    "offline", "disabled", "false", "no", "down", "fail", "failed",
    "离线", "异常",
  ].includes(normalized)) return false;
  return null;
}

/**
 * Confirmed state-of-charge fields only.
 *
 * - C4/C7/C8: pDianliang
 * - O1: vol (confirmed by DTA behaviour; integer 0..100 only)
 *
 * Temperature, capacity, pCheckResult and voltage-like decimal values are not
 * accepted as SOC.
 */
export function parseChargePercent(record: RecordValue): number | null {
  const value = numberValue(first(record, [
    "pDianliang", "pdianliang",
    "chargePercent", "charge_percent", "powerLevel", "power_level",
    "soc", "electricity", "batteryPower",
  ]));
  if (value != null) return value >= 0 && value <= 100 ? value : null;

  const dtaVol = numberValue(record.vol);
  return dtaVol != null && Number.isInteger(dtaVol) && dtaVol >= 0 && dtaVol <= 100
    ? dtaVol
    : null;
}

/** Explicit Celsius fields only. */
export function parseTemperatureC(record: RecordValue): number | null {
  const value = numberValue(first(record, [
    "pTemperature", "ptemperature",
    "temperatureC", "temperature_c", "temperature", "tempC", "temp_c", "temp",
  ]));
  return value != null && value >= -40 && value <= 100 ? value : null;
}

/** Diagnostics only. Never used as state of charge. */
export function parseVoltage(record: RecordValue): number | null {
  const value = numberValue(first(record, [
    "voltage", "voltageV", "voltage_v", "batteryVoltage",
  ]));
  return value != null && value >= 0 && value <= 1000 ? value : null;
}

/**
 * pCheckResult is deliberately not interpreted as pass/fail. Observed values
 * such as 96 and 100 are not a documented boolean contract.
 */
export function parseSelfCheck(record: RecordValue): "pass" | "fail" | "unknown" {
  const value = first(record, [
    "selfCheck", "self_check", "selfCheckStatus", "autoCheck", "auto_check",
  ]);
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
  if (["0", "0.0", "none", "normal", "ok", "false", "null"].includes(text.toLowerCase())) {
    return null;
  }
  return text;
}

export function parseFault(record: RecordValue) {
  return {
    error_code: nonBlockingZeroText(first(record, [
      "pErrid", "perrid", "pErrId", "errorCode", "error_code", "errId", "faultCode",
    ])),
    fault_type: nonBlockingZeroText(first(record, [
      "pFaultType", "pfaultType", "faultType", "fault_type",
    ])),
    fault_cause: nonBlockingZeroText(first(record, [
      "pFaultCause", "pfaultCause", "faultCause", "fault_cause",
    ])),
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

function parseSlotNum(record: RecordValue): number | null {
  const value = numberValue(first(record, [
    "pKakou", "pkakou", "pSubKakou", "psubKakou",
    "slotNum", "slot_num", "slot", "slotNo", "slotId", "port", "portNo", "channel",
  ]));
  return value != null && Number.isInteger(value) && value >= 1 && value <= 128
    ? value
    : null;
}

function parseBatteryId(record: RecordValue): string | null {
  // IMPORTANT: never use generic `sn` here. In the real C7 payload `sn` is a
  // provider module/slot serial (e.g. 22/24/25), while pBatteryid is the actual
  // power-bank identity. Treating `sn` as battery id creates false cross-source
  // conflicts and can make every slot fail closed.
  const value = first(record, [
    "pBatteryid", "pbatteryid",
    "batteryId", "batteryID", "batterySn", "batterySN", "battery_id",
    "bid", "powerBankId",
  ]);
  return value == null || String(value).trim() === "" ? null : String(value).trim();
}

function collectRecords(value: unknown, depth = 0): RecordValue[] {
  if (depth > 5) return [];
  if (Array.isArray(value)) return value.flatMap((item) => collectRecords(item, depth + 1));
  if (!isRecord(value)) return [];

  const own = parseSlotNum(value) != null || parseBatteryId(value) != null ? [value] : [];

  // C4 current slot state lives in cabinet.batcabs. Do not recurse into
  // subDeviceStatusReport: its lower-level B-fields have been observed lagging
  // the current C4/C7/C8/O1 battery values.
  const nested = Object.entries(value)
    .filter(([key, nestedValue]) =>
      /^(cabinet|device|cabinetInfo|deviceInfo|batcabs|list|rows|records|slots|slotList|batteries|batteryList|items)$/i.test(key)
      && (Array.isArray(nestedValue) || isRecord(nestedValue)))
    .flatMap(([, nestedValue]) => collectRecords(nestedValue, depth + 1));

  return [...own, ...nested];
}

function sourceOnline(record: RecordValue): boolean | null {
  return toBoolean(first(record, [
    "pInfostatus", "pinfostatus",
    "online", "isOnline", "onlineStatus", "networkStatus", "connectStatus",
  ]));
}

function rootOnline(payload: unknown): boolean | null {
  const value = unwrap(payload);
  if (!isRecord(value)) return null;

  const direct = sourceOnline(value);
  if (direct !== null) return direct;

  for (const key of ["cabinet", "device", "cabinetInfo", "deviceInfo"]) {
    const nested = value[key];
    if (!isRecord(nested)) continue;
    const nestedOnline = sourceOnline(nested);
    if (nestedOnline !== null) return nestedOnline;
  }
  return null;
}

function sourcePresent(record: RecordValue): boolean | null {
  const explicit = toBoolean(first(record, [
    "batteryPresent", "battery_present", "present", "isPresent", "hasBattery",
  ]));
  if (explicit !== null) return explicit;
  if (parseBatteryId(record)) return true;

  // A blank current battery id on an explicit C8 slot record means the
  // compartment is empty. pLastBatteryid is intentionally excluded.
  const batteryKeys = [
    "pBatteryid", "pbatteryid",
    "batteryId", "batteryID", "batterySn", "batterySN", "battery_id",
    "bid", "powerBankId",
  ];
  if (batteryKeys.some((key) =>
    Object.prototype.hasOwnProperty.call(record, key)
    && (record[key] == null || String(record[key]).trim() === "")
  )) return false;

  const slotState = first(record, [
    "slotStatus", "slot_status", "slotState", "slot_state", "compartmentStatus",
  ]);
  if (typeof slotState === "string"
      && ["empty", "vacant", "free", "available", "returnable"].includes(slotState.trim().toLowerCase())) {
    return false;
  }
  return null;
}

function sourceHealth(record: RecordValue): string | null {
  const value = first(record, ["healthStatus", "health_status", "batteryStatus", "status"]);
  return value != null && String(value).trim() !== ""
    ? String(value).trim().toLowerCase()
    : null;
}

function sourceMayEject(record: RecordValue): boolean | null {
  return toBoolean(first(record, ["rentable", "canRent", "canEject", "ejectable", "available"]));
}

function latest<T>(values: Array<{ value: T; timestamp: string }>): T | null {
  if (!values.length) return null;
  return [...values].sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0].value;
}

function latestKnown<T>(values: Array<{ value: T | null; timestamp: string }>): T | null {
  return latest(values.filter((item): item is { value: T; timestamp: string } => item.value !== null));
}

function conflicting<T>(values: T[]): boolean {
  return new Set(values.filter((value) => value !== null && value !== undefined).map(String)).size > 1;
}

function socConflict(values: number[]): boolean {
  if (values.length < 2) return false;
  const min = Math.min(...values);
  const max = Math.max(...values);
  return max - min > SOC_CONFLICT_TOLERANCE_PERCENT;
}

export function mergeCabinetSlotObservations(
  observations: Observation[],
  totalSlots = 4,
): CabinetSlotSnapshot[] {
  const perSlot = new Map<number, Observation[]>();

  for (const observation of observations) {
    for (const raw of collectRecords(unwrap(observation.raw))) {
      const slotNum = parseSlotNum(raw);
      if (slotNum == null) continue;
      const list = perSlot.get(slotNum) ?? [];
      list.push({ ...observation, raw });
      perSlot.set(slotNum, list);
    }
  }

  const maxSlot = Math.max(totalSlots, ...perSlot.keys(), 0);
  return Array.from({ length: maxSlot }, (_, index) => {
    const slotNum = index + 1;
    const slotObservations = perSlot.get(slotNum) ?? [];

    const batteryValues = slotObservations
      .map((item) => parseBatteryId(item.raw))
      .filter((value): value is string => Boolean(value));
    const chargeValues = slotObservations
      .map((item) => parseChargePercent(item.raw))
      .filter((value): value is number => value != null);
    const presentValues = slotObservations
      .map((item) => sourcePresent(item.raw))
      .filter((value): value is boolean => value != null);
    const onlineValues = slotObservations
      .map((item) => sourceOnline(item.raw))
      .filter((value): value is boolean => value != null);
    const ejectableValues = slotObservations
      .map((item) => sourceMayEject(item.raw))
      .filter((value): value is boolean => value != null);

    const conflicts: string[] = [];
    if (conflicting(batteryValues)) conflicts.push("battery_id");
    if (socConflict(chargeValues)) conflicts.push("charge_percent");
    if (conflicting(presentValues)) conflicts.push("battery_present");
    if (conflicting(onlineValues)) conflicts.push("online");

    const batteryId = latestKnown(slotObservations.map((item) => ({
      value: parseBatteryId(item.raw), timestamp: item.timestamp,
    })));
    const batteryPresent = latestKnown(slotObservations.map((item) => ({
      value: sourcePresent(item.raw), timestamp: item.timestamp,
    })));
    const chargePercent = latestKnown(slotObservations.map((item) => ({
      value: parseChargePercent(item.raw), timestamp: item.timestamp,
    })));
    const temperatureC = latestKnown(slotObservations.map((item) => ({
      value: parseTemperatureC(item.raw), timestamp: item.timestamp,
    })));
    const online = latestKnown(slotObservations.map((item) => ({
      value: sourceOnline(item.raw), timestamp: item.timestamp,
    })));
    const healthStatus = latestKnown(slotObservations.map((item) => ({
      value: sourceHealth(item.raw), timestamp: item.timestamp,
    })));

    const checks = slotObservations.map((item) => parseSelfCheck(item.raw));
    const selfCheck = checks.includes("fail")
      ? "fail"
      : checks.includes("pass") ? "pass" : "unknown";

    const faults = slotObservations.map((item) => parseFault(item.raw));
    const errorCode = faults.find((fault) => fault.error_code)?.error_code ?? null;
    const faultType = faults.find((fault) => fault.fault_type)?.fault_type ?? null;
    const faultCause = faults.find((fault) => fault.fault_cause)?.fault_cause ?? null;

    const newestTimestamp = slotObservations
      .map((item) => item.timestamp)
      .sort()
      .at(-1) ?? null;
    const dataAgeSeconds = newestTimestamp
      ? Math.max(0, Math.floor((Date.now() - Date.parse(newestTimestamp)) / 1000))
      : null;
    const freshEnough = dataAgeSeconds != null && dataAgeSeconds < 5 * 60;

    const confidence: SlotConfidence = conflicts.length
      ? "low"
      : slotObservations.length >= 2 && batteryId && freshEnough ? "high" : "medium";

    const blocking = Boolean(errorCode || faultType || faultCause)
      || selfCheck === "fail"
      || online === false
      || (temperatureC != null && (temperatureC < 0 || temperatureC > 55))
      || conflicts.length > 0;

    const supplierEjectable = ejectableValues.includes(false)
      ? false
      : ejectableValues.includes(true) ? true : null;

    const minimumCharge = minimumRentalChargePercent();
    const confirmedZeroBattery = Boolean(
      batteryPresent === true
      && chargePercent === 0
      && freshEnough
      && !conflicts.includes("charge_percent"),
    );

    const diagnosticFlags: string[] = [];
    if (confirmedZeroBattery) diagnosticFlags.push("zero_charge_reported");
    if (batteryPresent !== false && chargePercent != null && chargePercent > 0 && chargePercent < minimumCharge) {
      diagnosticFlags.push("charge_below_rental_threshold");
    }

    const rentable = Boolean(
      batteryId
      && batteryPresent !== false
      && online !== false
      && !blocking
      && freshEnough
      && confidence !== "low"
      && supplierEjectable !== false
      && chargePercent != null
      && chargePercent >= minimumCharge,
    );

    const customerStatus: SlotCustomerStatus = batteryPresent === false
      ? "return_available"
      : confirmedZeroBattery
      ? "technical_issue"
      : conflicts.length || confidence === "low" || batteryPresent === null || chargePercent === null
      ? "checking"
      : rentable
      ? "ready"
      : blocking
      ? "maintenance"
      : !batteryId
      ? "unavailable"
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
      error_code: errorCode,
      fault_type: faultType,
      fault_cause: faultCause,
      rentable,
      confidence,
      customer_status: customerStatus,
      diagnostic_flags: diagnosticFlags,
      source_timestamps: Object.fromEntries(
        slotObservations.map((item) => [item.source, item.timestamp]),
      ),
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
    .map(([source, result]) => ({
      source,
      timestamp,
      raw: result.data as RecordValue,
    }));

  const online = latestKnown(
    observations.map((item) => ({ value: rootOnline(item.raw), timestamp: item.timestamp })),
  );

  return {
    cabinet_id: cabinetId,
    online,
    sources: Object.fromEntries(
      results.map(([source, result]) => [source, sourceMeta(result, timestamp)]),
    ),
    slots: mergeCabinetSlotObservations(observations),
  };
}
