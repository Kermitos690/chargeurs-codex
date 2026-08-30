import { batteryListByCabinetId, cabinetDetail, cabinetQuery, slotByCabinetId } from "./chargenow.mjs";

const DEFAULT_MIN_RENTAL_CHARGE_PERCENT = 20;
const SOC_CONFLICT_TOLERANCE_PERCENT = 5;

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const numberValue = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};
const first = (record, keys) => {
  for (const key of keys) if (record[key] !== undefined && record[key] !== null) return record[key];
  return undefined;
};
const toBoolean = (value) => {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1") return true;
  if (value === 0 || value === "0") return false;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (["online","ready","normal","active","true","yes","up","pass","passed","在线","正常"].includes(normalized)) return true;
  if (["offline","disabled","false","no","down","fail","failed","离线","异常"].includes(normalized)) return false;
  return null;
};

function minimumRentalChargePercent() {
  const configured = Number(process.env.MIN_RENTAL_BATTERY_PERCENT || DEFAULT_MIN_RENTAL_CHARGE_PERCENT);
  return Number.isFinite(configured) && configured >= 1 && configured <= 100 ? configured : DEFAULT_MIN_RENTAL_CHARGE_PERCENT;
}

function parseChargePercent(record) {
  const value = numberValue(first(record, ["pDianliang","pdianliang","chargePercent","charge_percent","powerLevel","power_level","soc","electricity","batteryPower"]));
  if (value != null) return value >= 0 && value <= 100 ? value : null;
  const dtaVol = numberValue(record.vol);
  return dtaVol != null && Number.isInteger(dtaVol) && dtaVol >= 0 && dtaVol <= 100 ? dtaVol : null;
}

function parseTemperatureC(record) {
  const value = numberValue(first(record, ["pTemperature","ptemperature","temperatureC","temperature_c","temperature","tempC","temp_c","temp"]));
  return value != null && value >= -40 && value <= 100 ? value : null;
}

function parseSelfCheck(record) {
  const value = first(record, ["selfCheck","self_check","selfCheckStatus","autoCheck","auto_check"]);
  const bool = toBoolean(value);
  if (bool === true) return "pass";
  if (bool === false) return "fail";
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (["ok","normal","success"].includes(text)) return "pass";
  if (["error","abnormal","invalid"].includes(text)) return "fail";
  return "unknown";
}

function nonBlockingZeroText(value) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text || ["0","0.0","none","normal","ok","false","null"].includes(text.toLowerCase())) return null;
  return text;
}
function parseFault(record) {
  return {
    error_code: nonBlockingZeroText(first(record,["pErrid","perrid","pErrId","errorCode","error_code","errId","faultCode"])),
    fault_type: nonBlockingZeroText(first(record,["pFaultType","pfaultType","faultType","fault_type"])),
    fault_cause: nonBlockingZeroText(first(record,["pFaultCause","pfaultCause","faultCause","fault_cause"])),
  };
}

function unwrap(value) {
  let current = value;
  for (let n = 0; n < 4 && isRecord(current); n += 1) {
    const next = first(current,["data","result","payload"]);
    if (!isRecord(next) && !Array.isArray(next)) return current;
    current = next;
  }
  return current;
}
function parseSlotNum(record) {
  const value = numberValue(first(record,["pKakou","pkakou","pSubKakou","psubKakou","slotNum","slot_num","slot","slotNo","slotId","port","portNo","channel"]));
  return value != null && Number.isInteger(value) && value >= 1 && value <= 128 ? value : null;
}
function parseBatteryId(record) {
  const value = first(record,["pBatteryid","pbatteryid","batteryId","batteryID","batterySn","batterySN","battery_id","bid","powerBankId"]);
  return value == null || String(value).trim() === "" ? null : String(value).trim();
}
function collectRecords(value, depth = 0) {
  if (depth > 5) return [];
  if (Array.isArray(value)) return value.flatMap((item) => collectRecords(item, depth + 1));
  if (!isRecord(value)) return [];
  const own = parseSlotNum(value) != null || parseBatteryId(value) != null ? [value] : [];
  const nested = Object.entries(value)
    .filter(([key,nestedValue]) => /^(cabinet|device|cabinetInfo|deviceInfo|batcabs|list|rows|records|slots|slotList|batteries|batteryList|items)$/i.test(key) && (Array.isArray(nestedValue) || isRecord(nestedValue)))
    .flatMap(([,nestedValue]) => collectRecords(nestedValue, depth + 1));
  return [...own, ...nested];
}
function sourceOnline(record) { return toBoolean(first(record,["pInfostatus","pinfostatus","online","isOnline","onlineStatus","networkStatus","connectStatus"])); }
function rootOnline(payload) {
  const value = unwrap(payload);
  if (!isRecord(value)) return null;
  const direct = sourceOnline(value);
  if (direct !== null) return direct;
  for (const key of ["cabinet","device","cabinetInfo","deviceInfo"]) {
    const nested = value[key];
    if (isRecord(nested)) {
      const online = sourceOnline(nested);
      if (online !== null) return online;
    }
  }
  return null;
}
function sourcePresent(record) {
  const explicit = toBoolean(first(record,["batteryPresent","battery_present","present","isPresent","hasBattery"]));
  if (explicit !== null) return explicit;
  if (parseBatteryId(record)) return true;
  const batteryKeys = ["pBatteryid","pbatteryid","batteryId","batteryID","batterySn","batterySN","battery_id","bid","powerBankId"];
  if (batteryKeys.some((key) => Object.prototype.hasOwnProperty.call(record,key) && (record[key] == null || String(record[key]).trim() === ""))) return false;
  const slotState = first(record,["slotStatus","slot_status","slotState","slot_state","compartmentStatus"]);
  if (typeof slotState === "string" && ["empty","vacant","free","available","returnable"].includes(slotState.trim().toLowerCase())) return false;
  return null;
}
function sourceHealth(record) {
  const value = first(record,["healthStatus","health_status","batteryStatus","status"]);
  return value != null && String(value).trim() ? String(value).trim().toLowerCase() : null;
}
function sourceMayEject(record) { return toBoolean(first(record,["rentable","canRent","canEject","ejectable","available"])); }
function latestKnown(values) {
  const known = values.filter((item) => item.value !== null && item.value !== undefined);
  if (!known.length) return null;
  return [...known].sort((a,b) => b.timestamp.localeCompare(a.timestamp))[0].value;
}
function conflicting(values) { return new Set(values.map(String)).size > 1; }
function socConflict(values) { return values.length >= 2 && Math.max(...values) - Math.min(...values) > SOC_CONFLICT_TOLERANCE_PERCENT; }

function mergeCabinetSlotObservations(observations, totalSlots = 4) {
  const perSlot = new Map();
  for (const observation of observations) {
    for (const raw of collectRecords(unwrap(observation.raw))) {
      const slotNum = parseSlotNum(raw);
      if (slotNum == null) continue;
      const list = perSlot.get(slotNum) || [];
      list.push({ ...observation, raw });
      perSlot.set(slotNum, list);
    }
  }
  const maxSlot = Math.max(totalSlots, ...perSlot.keys(), 0);
  return Array.from({ length: maxSlot }, (_, index) => {
    const slot_num = index + 1;
    const items = perSlot.get(slot_num) || [];
    const batteryValues = items.map((i) => parseBatteryId(i.raw)).filter(Boolean);
    const chargeValues = items.map((i) => parseChargePercent(i.raw)).filter((v) => v != null);
    const presentValues = items.map((i) => sourcePresent(i.raw)).filter((v) => v != null);
    const onlineValues = items.map((i) => sourceOnline(i.raw)).filter((v) => v != null);
    const ejectableValues = items.map((i) => sourceMayEject(i.raw)).filter((v) => v != null);
    const conflicts = [];
    if (conflicting(batteryValues)) conflicts.push("battery_id");
    if (socConflict(chargeValues)) conflicts.push("charge_percent");
    if (conflicting(presentValues)) conflicts.push("battery_present");
    if (conflicting(onlineValues)) conflicts.push("online");
    const battery_id = latestKnown(items.map((i) => ({ value: parseBatteryId(i.raw), timestamp: i.timestamp })));
    const battery_present = latestKnown(items.map((i) => ({ value: sourcePresent(i.raw), timestamp: i.timestamp })));
    const charge_percent = latestKnown(items.map((i) => ({ value: parseChargePercent(i.raw), timestamp: i.timestamp })));
    const temperature_c = latestKnown(items.map((i) => ({ value: parseTemperatureC(i.raw), timestamp: i.timestamp })));
    const online = latestKnown(items.map((i) => ({ value: sourceOnline(i.raw), timestamp: i.timestamp })));
    const health_status = latestKnown(items.map((i) => ({ value: sourceHealth(i.raw), timestamp: i.timestamp })));
    const checks = items.map((i) => parseSelfCheck(i.raw));
    const self_check = checks.includes("fail") ? "fail" : checks.includes("pass") ? "pass" : "unknown";
    const faults = items.map((i) => parseFault(i.raw));
    const error_code = faults.find((f) => f.error_code)?.error_code || null;
    const fault_type = faults.find((f) => f.fault_type)?.fault_type || null;
    const fault_cause = faults.find((f) => f.fault_cause)?.fault_cause || null;
    const newestTimestamp = items.map((i) => i.timestamp).sort().at(-1) || null;
    const data_age_seconds = newestTimestamp ? Math.max(0, Math.floor((Date.now() - Date.parse(newestTimestamp)) / 1000)) : null;
    const freshEnough = data_age_seconds != null && data_age_seconds < 300;
    const confidence = conflicts.length ? "low" : items.length >= 2 && battery_id && freshEnough ? "high" : "medium";
    const blocking = Boolean(error_code || fault_type || fault_cause) || self_check === "fail" || online === false || (temperature_c != null && (temperature_c < 0 || temperature_c > 55)) || conflicts.length > 0;
    const supplierEjectable = ejectableValues.includes(false) ? false : ejectableValues.includes(true) ? true : null;
    const minimumCharge = minimumRentalChargePercent();
    const rentable = Boolean(battery_id && battery_present !== false && online !== false && !blocking && freshEnough && confidence !== "low" && supplierEjectable !== false && charge_percent != null && charge_percent >= minimumCharge);
    const status = battery_present === false ? "return_available" : conflicts.length || confidence === "low" || battery_present === null || charge_percent === null ? "checking" : rentable ? "ready" : blocking ? "maintenance" : !battery_id ? "unavailable" : "charging";
    return { slot_num, battery_id, battery_present, charge_percent, temperature_c, online, health_status, self_check, error_code, fault_type, fault_cause, rentable, confidence, status, conflicts, data_age_seconds };
  });
}

export async function readCabinetSnapshot(cabinetId) {
  const timestamp = new Date().toISOString();
  const [c4,c7,c8,o1] = await Promise.all([
    cabinetDetail(cabinetId),
    batteryListByCabinetId(cabinetId),
    slotByCabinetId(cabinetId),
    cabinetQuery(cabinetId),
  ]);
  const results = [["c4_detail",c4],["c7_batteries",c7],["c8_slots",c8],["o1_query",o1]];
  const observations = results.filter(([,result]) => result.ok && isRecord(result.data)).map(([source,result]) => ({ source, timestamp, raw: result.data }));
  const online = latestKnown(observations.map((item) => ({ value: rootOnline(item.raw), timestamp: item.timestamp })));
  return {
    cabinet_id: cabinetId,
    online,
    sources: Object.fromEntries(results.map(([source,result]) => [source,{ ok: result.ok, status: result.status, timestamp }])),
    slots: mergeCabinetSlotObservations(observations, 4),
  };
}
