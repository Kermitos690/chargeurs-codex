import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { cabinetQuery, isChargeNowConfigured } from "./chargenow.ts";
import { logApi } from "./db.ts";

export interface CabinetInfo {
  online?: boolean;
  onlineStatus?: number;
  status?: string;
  slots?: number;
  slotNum?: number;
  totalSlots?: number;
  emptySlots?: number;
  signal?: number;
  signalStrength?: number;
}

export interface BatteryInfo {
  slotNum?: number;
  slot?: number;
  slotId?: number;
  batteryId?: string;
  sn?: string;
  bid?: string;
  vol?: number;
  batteryCapacity?: number;
  power?: number;
  electricity?: number;
}

interface CabinetPayload {
  cabinet?: CabinetInfo;
  batteries?: BatteryInfo[];
  slots?: BatteryInfo[];
  data?: CabinetPayload;
  [key: string]: unknown;
}

export type ParsedCabinetState = {
  payload: CabinetPayload;
  online: boolean;
  signal: number | null;
  total: number;
  rentable: number;
  returnable: number;
  batteries: Array<{
    slotNum: number;
    batteryId: string;
    powerLevel: number | null;
    raw: BatteryInfo;
  }>;
};

export type StationSyncResult =
  | { ok: true; stationId: string; online: boolean; rentable: number; returnable: number; total: number }
  | { ok: false; stationId: string; error: string; configured: boolean };

export function parseCabinetState(value: unknown): ParsedCabinetState {
  const root = (value ?? {}) as CabinetPayload;
  const payload = (root.data ?? root) as CabinetPayload;
  const cabinet = (payload.cabinet ?? payload) as CabinetInfo;
  const online = cabinet.online === true || cabinet.onlineStatus === 1 || cabinet.status === "online";
  const sourceBatteries: BatteryInfo[] = Array.isArray(payload.batteries)
    ? payload.batteries
    : (Array.isArray(payload.slots) ? payload.slots : []).filter((item) => item.batteryId || item.sn || item.bid);

  const batteries = sourceBatteries.flatMap((item) => {
    const slotNum = item.slotNum ?? item.slot ?? item.slotId;
    const batteryId = item.batteryId ?? item.sn ?? item.bid;
    if (slotNum == null || !batteryId) return [];
    return [{
      slotNum: Number(slotNum),
      batteryId: String(batteryId),
      powerLevel: item.vol ?? item.batteryCapacity ?? item.power ?? item.electricity ?? null,
      raw: item,
    }];
  });

  const totalCandidate = Number(cabinet.slots ?? cabinet.slotNum ?? cabinet.totalSlots ?? 0);
  const total = Number.isFinite(totalCandidate) && totalCandidate >= 0 ? totalCandidate : 0;
  const rentable = batteries.length;
  const emptyCandidate = Number(cabinet.emptySlots ?? (total > 0 ? total - rentable : 0));
  const returnable = Number.isFinite(emptyCandidate) ? Math.max(0, emptyCandidate) : 0;
  const signalCandidate = cabinet.signal ?? cabinet.signalStrength ?? null;
  const signal = signalCandidate == null || !Number.isFinite(Number(signalCandidate)) ? null : Number(signalCandidate);

  return { payload, online, signal, total, rentable, returnable, batteries };
}

export async function syncStationFromChargeNow(
  db: SupabaseClient,
  station: { station_id: string; cabinet_id?: string | null },
): Promise<StationSyncResult> {
  const stationId = String(station.station_id);
  const deviceId = String(station.cabinet_id || station.station_id);

  if (!isChargeNowConfigured()) {
    return { ok: false, stationId, error: "CHARGENOW_NOT_CONFIGURED", configured: false };
  }

  const response = await cabinetQuery(deviceId);
  await logApi(db, {
    service: "chargenow",
    endpoint: "/rent/cabinet/query",
    method: "GET",
    status_code: response.status,
    request: { deviceId },
    response: response.data,
    error: response.error,
  });

  if (!response.ok || !response.data) {
    await db.from("stations").update({
      status: "unknown",
      online: false,
      last_sync_at: new Date().toISOString(),
    }).eq("station_id", stationId);
    return { ok: false, stationId, error: response.error ?? "CHARGENOW_UNAVAILABLE", configured: true };
  }

  const parsed = parseCabinetState(response.data);
  const now = new Date().toISOString();
  const { error: stationError } = await db.from("stations").update({
    status: parsed.online ? "online" : "offline",
    online: parsed.online,
    signal: parsed.signal,
    rentable_count: parsed.rentable,
    returnable_count: parsed.returnable,
    total_count: parsed.total,
    last_sync_at: now,
    raw_data: parsed.payload,
  }).eq("station_id", stationId);
  if (stationError) {
    return { ok: false, stationId, error: `DATABASE_ERROR:${stationError.message}`, configured: true };
  }

  const bySlot = new Map(parsed.batteries.map((battery) => [battery.slotNum, battery]));
  const slotNumbers = parsed.total > 0
    ? Array.from({ length: parsed.total }, (_, index) => index + 1)
    : [...bySlot.keys()].sort((a, b) => a - b);

  for (const slotNum of slotNumbers) {
    const battery = bySlot.get(slotNum);
    await db.from("slots").upsert({
      station_id: stationId,
      slot_num: slotNum,
      status: battery ? "occupied" : "empty",
      battery_id: battery?.batteryId ?? null,
      raw_data: battery?.raw ?? {},
    }, { onConflict: "station_id,slot_num" });
  }

  const currentBatteryIds = parsed.batteries.map((battery) => battery.batteryId);
  const { data: previouslyPresent } = await db.from("batteries")
    .select("battery_id")
    .eq("station_id", stationId);
  for (const row of previouslyPresent ?? []) {
    if (!currentBatteryIds.includes(String(row.battery_id))) {
      await db.from("batteries").update({
        station_id: null,
        slot_num: null,
        status: "out_of_station",
        updated_at: now,
      }).eq("battery_id", row.battery_id);
    }
  }

  for (const battery of parsed.batteries) {
    await db.from("batteries").upsert({
      battery_id: battery.batteryId,
      station_id: stationId,
      slot_num: battery.slotNum,
      status: "in_station",
      power_level: battery.powerLevel,
      raw_data: battery.raw,
      updated_at: now,
    }, { onConflict: "battery_id" });
  }

  return {
    ok: true,
    stationId,
    online: parsed.online,
    rentable: parsed.rentable,
    returnable: parsed.returnable,
    total: parsed.total,
  };
}
