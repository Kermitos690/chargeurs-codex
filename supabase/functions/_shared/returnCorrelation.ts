// Pure return-event parsing and rental correlation. No database or network I/O.

export type ReturnEventIdentity = {
  eventId: string | null;
  stationId: string | null;
  batteryId: string | null;
  tradeNo: string | null;
  slotNum: number | null;
};

export type ReturnCandidate = {
  id: string;
  stationId: string;
  state: string;
  batteryId: string | null;
  tradeNo: string | null;
  createdAt?: string | null;
};

export type ReturnCorrelation =
  | { ok: true; rentalId: string; matchedBy: "trade_no" | "battery_id" | "single_station_candidate" }
  | { ok: false; error: "NO_IDENTITY" | "NO_MATCH" | "AMBIGUOUS_MATCH" | "STATION_MISMATCH" };

const ACTIVE_RETURN_STATES = new Set(["ejected", "battery_taken", "active_rental"]);

function firstString(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function firstNumber(source: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = source[key];
    const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isInteger(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

export function parseReturnIdentity(payload: Record<string, unknown>): ReturnEventIdentity {
  const nested = payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
    ? payload.data as Record<string, unknown>
    : {};
  const merged = { ...payload, ...nested };
  return {
    eventId: firstString(merged, ["messageId", "eventId", "msgId", "id"]),
    stationId: firstString(merged, ["deviceId", "cabinetid", "cabinetId", "stationId", "cabinetSn"]),
    batteryId: firstString(merged, ["batteryId", "batterySN", "batterySn", "batteryCode", "sn", "bid"]),
    tradeNo: firstString(merged, ["tradeNo", "trade_no", "orderNo"]),
    slotNum: firstNumber(merged, ["slotNum", "slot", "slotId", "position"]),
  };
}

export function correlateReturn(identity: ReturnEventIdentity, candidates: ReturnCandidate[]): ReturnCorrelation {
  const active = candidates.filter((candidate) => ACTIVE_RETURN_STATES.has(candidate.state));
  if (!identity.tradeNo && !identity.batteryId && !identity.stationId) return { ok: false, error: "NO_IDENTITY" };

  if (identity.tradeNo) {
    const matches = active.filter((candidate) => candidate.tradeNo === identity.tradeNo);
    if (matches.length > 1) return { ok: false, error: "AMBIGUOUS_MATCH" };
    if (matches.length === 1) {
      if (identity.stationId && matches[0].stationId !== identity.stationId) return { ok: false, error: "STATION_MISMATCH" };
      return { ok: true, rentalId: matches[0].id, matchedBy: "trade_no" };
    }
  }

  if (identity.batteryId) {
    const matches = active.filter((candidate) => candidate.batteryId === identity.batteryId);
    if (matches.length > 1) return { ok: false, error: "AMBIGUOUS_MATCH" };
    if (matches.length === 1) {
      return { ok: true, rentalId: matches[0].id, matchedBy: "battery_id" };
    }
  }

  if (identity.stationId) {
    const matches = active.filter((candidate) => candidate.stationId === identity.stationId);
    if (matches.length > 1) return { ok: false, error: "AMBIGUOUS_MATCH" };
    if (matches.length === 1) return { ok: true, rentalId: matches[0].id, matchedBy: "single_station_candidate" };
  }

  return { ok: false, error: "NO_MATCH" };
}

export function extractEjectedBattery(payload: unknown): { batteryId: string | null; slotNum: number | null } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { batteryId: null, slotNum: null };
  const root = payload as Record<string, unknown>;
  const data = root.data && typeof root.data === "object" && !Array.isArray(root.data)
    ? root.data as Record<string, unknown>
    : root;
  return {
    batteryId: firstString(data, ["batteryId", "batterySN", "batterySn", "batteryCode", "sn", "bid"]),
    slotNum: firstNumber(data, ["slotNum", "slot", "slotId", "position"]),
  };
}
