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

function trustworthy(slot: SafeReleaseSlot | undefined): boolean {
  return Boolean(slot && slot.confidence !== "low" && slot.conflicts.length === 0);
}

function trustworthyEmpty(slot: SafeReleaseSlot | undefined): boolean {
  return Boolean(trustworthy(slot) && slot?.battery_present === false);
}

function trustworthyOccupied(slot: SafeReleaseSlot | undefined): boolean {
  return Boolean(trustworthy(slot) && slot?.battery_present === true && slot.battery_id);
}

/**
 * The safety proof needs a trustworthy baseline for every physical compartment,
 * not merely for the battery selected by the customer. Otherwise a second
 * compartment could open and there would be no reliable way to tell whether it
 * changed after C3.
 */
export function releaseBaselineReady(snapshot: SafeReleaseSnapshot, totalSlots = 4): boolean {
  if (snapshot.slots.length < totalSlots) return false;
  for (let slotNum = 1; slotNum <= totalSlots; slotNum += 1) {
    const slot = snapshot.slots.find((candidate) => candidate.slot_num === slotNum);
    if (!trustworthyEmpty(slot) && !trustworthyOccupied(slot)) return false;
  }
  return true;
}

/**
 * Compare the exact physical compartments that were CONFIRMED occupied before
 * C3. Missing telemetry is never interpreted as a release. Only an explicit,
 * conflict-free post-command empty observation counts.
 */
export function classifyReleaseDelta(
  pre: SafeReleaseSnapshot,
  post: SafeReleaseSnapshot,
  selectedSlotNum: number,
): ReleaseDelta {
  const postBySlot = new Map(post.slots.map((slot) => [slot.slot_num, slot]));
  const released = pre.slots
    .filter((slot) => trustworthyOccupied(slot))
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
