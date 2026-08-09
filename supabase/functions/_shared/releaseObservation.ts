import type { CabinetSnapshot } from "./cabinetSnapshot.ts";

export type SafeReleaseSlot = {
  slot_num: number;
  battery_id: string | null;
  battery_present: boolean | null;
  confidence: "high" | "medium" | "low";
  conflicts: string[];
};

export type SafeReleaseSnapshot = {
  cabinet_id: string;
  observed_at: string;
  slots: SafeReleaseSlot[];
};

export type ReleaseDelta = {
  result: "pending" | "single_release" | "unexpected_release" | "multi_release";
  released_slot_nums: number[];
  released_battery_ids: string[];
  selected_slot_released: boolean;
};

export function safeReleaseSnapshot(snapshot: CabinetSnapshot, observedAt = new Date().toISOString()): SafeReleaseSnapshot {
  return {
    cabinet_id: snapshot.cabinet_id,
    observed_at: observedAt,
    slots: snapshot.slots.map((slot) => ({
      slot_num: slot.slot_num,
      battery_id: slot.battery_id,
      battery_present: slot.battery_present,
      confidence: slot.confidence,
      conflicts: [...slot.conflicts],
    })),
  };
}

function trustworthyEmpty(slot: SafeReleaseSlot | undefined): boolean {
  return Boolean(slot && slot.battery_present === false && slot.confidence !== "low" && slot.conflicts.length === 0);
}

/**
 * Compare the exact physical compartments that were occupied before C3.
 * Missing telemetry is never interpreted as a release. Only an explicit,
 * conflict-free post-command empty observation counts.
 */
export function classifyReleaseDelta(
  pre: SafeReleaseSnapshot,
  post: SafeReleaseSnapshot,
  selectedSlotNum: number,
): ReleaseDelta {
  const postBySlot = new Map(post.slots.map((slot) => [slot.slot_num, slot]));
  const released = pre.slots
    .filter((slot) => slot.battery_present !== false && Boolean(slot.battery_id))
    .filter((slot) => trustworthyEmpty(postBySlot.get(slot.slot_num)));

  const releasedSlotNums = released.map((slot) => slot.slot_num).sort((a, b) => a - b);
  const releasedBatteryIds = released.map((slot) => slot.battery_id).filter((id): id is string => Boolean(id));
  const selectedReleased = releasedSlotNums.includes(selectedSlotNum);

  if (releasedSlotNums.length > 1) {
    return {
      result: "multi_release",
      released_slot_nums: releasedSlotNums,
      released_battery_ids: releasedBatteryIds,
      selected_slot_released: selectedReleased,
    };
  }
  if (releasedSlotNums.length === 1 && selectedReleased) {
    return {
      result: "single_release",
      released_slot_nums: releasedSlotNums,
      released_battery_ids: releasedBatteryIds,
      selected_slot_released: true,
    };
  }
  if (releasedSlotNums.length === 1) {
    return {
      result: "unexpected_release",
      released_slot_nums: releasedSlotNums,
      released_battery_ids: releasedBatteryIds,
      selected_slot_released: false,
    };
  }
  return {
    result: "pending",
    released_slot_nums: [],
    released_battery_ids: [],
    selected_slot_released: false,
  };
}
