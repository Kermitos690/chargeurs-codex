import type { ApiResult } from "./chargenow.ts";
import type { ChargeNowBattery, ParsedCabinetStatus } from "./chargenowStatus.ts";

export const DTA_PILOT_STATION_ID = "DTA21269";

export type ProviderOrderIdentity = {
  tradeNo: string | null;
  orderId: string | null;
};

export type ProviderReleaseIdentity = {
  batteryId: string | null;
  slotNum: number | null;
};

export type QualificationRunShape = {
  state: string;
  requested_slot_num: number | null;
  expected_battery_id: string | null;
  observed_battery_id: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unwrap(value: unknown): Record<string, unknown> {
  let current = isRecord(value) ? value : {};
  for (let depth = 0; depth < 4; depth += 1) {
    const next = current.data ?? current.result ?? current.payload;
    if (!isRecord(next)) return current;
    current = next;
  }
  return current;
}

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if ((typeof value === "string" || typeof value === "number") && String(value).trim()) {
      return String(value).trim();
    }
  }
  return null;
}

function firstInteger(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isInteger(value) && value >= 0) return value;
  }
  return null;
}

export function providerBusinessCode(value: unknown): string | null {
  if (!isRecord(value) || value.code === undefined || value.code === null) return null;
  return String(value.code).trim();
}

export function providerResultSucceeded(result: ApiResult): boolean {
  if (result.ok) return true;
  return result.status >= 200 && result.status < 300 && providerBusinessCode(result.data) === "0";
}

export function extractProviderOrderIdentity(value: unknown): ProviderOrderIdentity {
  const root = isRecord(value) ? value : {};
  const data = unwrap(value);
  return {
    tradeNo: firstString(data, ["tradeNo", "trade_no", "orderNo", "tradeId"])
      ?? firstString(root, ["tradeNo", "trade_no", "orderNo", "tradeId"]),
    orderId: firstString(data, ["orderId", "order_id", "rentOrderId", "id"])
      ?? firstString(root, ["orderId", "order_id", "rentOrderId"]),
  };
}

export function extractProviderReleaseIdentity(value: unknown): ProviderReleaseIdentity {
  const root = isRecord(value) ? value : {};
  const data = unwrap(value);
  const battery = isRecord(data.battery) ? data.battery : data;
  return {
    batteryId: firstString(battery, ["batteryId", "battery_id", "batterySn", "batterySN", "sn", "bid", "powerBankId"])
      ?? firstString(root, ["batteryId", "battery_id", "batterySn", "batterySN", "sn", "bid"]),
    slotNum: firstInteger(battery, ["slotNum", "slot", "slotId", "port", "portNo", "channel"])
      ?? firstInteger(root, ["slotNum", "slot", "slotId", "port", "portNo", "channel"]),
  };
}

export function choosePilotBattery(
  status: ParsedCabinetStatus,
  requestedSlot?: number | null,
): ChargeNowBattery | null {
  const candidates = status.batteries
    .filter((battery) => battery.batteryId && battery.slotNum != null && battery.slotNum >= 1)
    .sort((left, right) => Number(left.slotNum) - Number(right.slotNum));
  if (requestedSlot != null) {
    return candidates.find((battery) => battery.slotNum === requestedSlot) ?? null;
  }
  return candidates[0] ?? null;
}

export type ReconciliationDecision = {
  state: "ejection_confirmed" | "battery_taken" | "return_confirmed" | "completed" | "needs_reconciliation";
  observedBatteryId: string | null;
  observedSlotNum: number | null;
  reason: string;
};

export function reconcileQualificationRun(
  run: QualificationRunShape,
  latest: ParsedCabinetStatus,
): ReconciliationDecision {
  const expectedBattery = run.observed_battery_id ?? run.expected_battery_id;
  const requestedSlot = run.requested_slot_num;
  if (!expectedBattery || requestedSlot == null) {
    return {
      state: "needs_reconciliation",
      observedBatteryId: expectedBattery ?? null,
      observedSlotNum: requestedSlot ?? null,
      reason: "QUALIFICATION_IDENTITY_INCOMPLETE",
    };
  }

  const present = latest.batteries.find((battery) => battery.batteryId === expectedBattery) ?? null;
  if (["ejection_requested", "ejection_confirmed"].includes(run.state)) {
    if (!present) {
      return {
        state: "battery_taken",
        observedBatteryId: expectedBattery,
        observedSlotNum: requestedSlot,
        reason: "EXPECTED_BATTERY_ABSENT_AFTER_EJECTION",
      };
    }
    return {
      state: "needs_reconciliation",
      observedBatteryId: expectedBattery,
      observedSlotNum: present.slotNum,
      reason: present.slotNum === requestedSlot
        ? "EXPECTED_BATTERY_STILL_PRESENT_IN_REQUESTED_SLOT"
        : "EXPECTED_BATTERY_PRESENT_IN_DIFFERENT_SLOT",
    };
  }

  if (["battery_taken", "needs_reconciliation"].includes(run.state)) {
    if (present) {
      return {
        state: "completed",
        observedBatteryId: expectedBattery,
        observedSlotNum: present.slotNum,
        reason: "EXPECTED_BATTERY_PRESENT_AFTER_RETURN",
      };
    }
    return {
      state: "battery_taken",
      observedBatteryId: expectedBattery,
      observedSlotNum: requestedSlot,
      reason: "EXPECTED_BATTERY_STILL_OUTSIDE_NETWORK",
    };
  }

  return {
    state: "needs_reconciliation",
    observedBatteryId: expectedBattery,
    observedSlotNum: present?.slotNum ?? requestedSlot,
    reason: "QUALIFICATION_STATE_NOT_RECONCILABLE",
  };
}

export function safeProviderError(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value : "";
  return /^[A-Z0-9_:-]{1,120}$/.test(text) ? text : fallback;
}
