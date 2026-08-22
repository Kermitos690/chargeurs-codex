import {
  choosePilotBattery,
  MULTI_BATTERY_RELEASE_OBSERVED,
  preservedMultiReleaseFailure,
  providerResultSucceeded,
  reconcileQualificationRun,
} from "../_shared/dtaPilot.ts";
import type { ParsedCabinetStatus } from "../_shared/chargenowStatus.ts";

const status = (batteryRows: Array<{ slotNum: number; batteryId: string; powerLevel?: number }>): ParsedCabinetStatus => ({
  recognized: true,
  online: true,
  totalCount: 8,
  rentableCount: batteryRows.length,
  returnableCount: 8 - batteryRows.length,
  signal: 80,
  batteries: batteryRows.map((battery) => ({
    slotNum: battery.slotNum,
    batteryId: battery.batteryId,
    powerLevel: battery.powerLevel ?? null,
    raw: battery,
  })),
  payload: { cabinet: { online: true, slots: 8 } },
});

const snapshot = (batteryRows: Array<{ slotNum: number; batteryId: string; powerLevel?: number }>) => ({
  cabinet: { online: true, slots: 8 },
  batteries: batteryRows.map((battery) => ({
    slotNum: battery.slotNum,
    batteryId: battery.batteryId,
    vol: battery.powerLevel ?? 100,
  })),
});

Deno.test("DTA pilot accepts provider business code zero serialized as text", () => {
  const result = providerResultSucceeded({
    ok: false,
    status: 200,
    data: { code: "0", data: {} },
    error: "PROVIDER_BUSINESS_CODE_0",
  });
  if (!result) throw new Error("expected provider result to be accepted");
});

Deno.test("DTA pilot automatically selects the next battery not already cycled", () => {
  const selected = choosePilotBattery(
    status([
      { slotNum: 1, batteryId: "BAT-A" },
      { slotNum: 2, batteryId: "BAT-B" },
      { slotNum: 3, batteryId: "BAT-C" },
    ]),
    null,
    new Set(["BAT-A", "BAT-B"]),
  );
  if (selected?.batteryId !== "BAT-C" || selected.slotNum !== 3) {
    throw new Error(`unexpected selection: ${JSON.stringify(selected)}`);
  }
});

Deno.test("DTA pilot requested slot overrides automatic campaign ordering", () => {
  const selected = choosePilotBattery(
    status([
      { slotNum: 2, batteryId: "BAT-B" },
      { slotNum: 5, batteryId: "BAT-E" },
    ]),
    5,
  );
  if (selected?.batteryId !== "BAT-E") throw new Error("requested slot was not selected");
});

Deno.test("DTA pilot marks a confirmed ejection as battery taken after inventory absence", () => {
  const decision = reconcileQualificationRun({
    state: "ejection_confirmed",
    requested_slot_num: 2,
    expected_battery_id: "BAT-B",
    observed_battery_id: "BAT-B",
  }, status([{ slotNum: 1, batteryId: "BAT-A" }]));
  if (decision.state !== "battery_taken") throw new Error(`unexpected state ${decision.state}`);
});

Deno.test("DTA pilot fails closed when a second battery disappears after one requested ejection", () => {
  const decision = reconcileQualificationRun({
    state: "ejection_confirmed",
    requested_slot_num: 4,
    expected_battery_id: "BAT-D",
    observed_battery_id: "BAT-D",
    initial_snapshot: snapshot([
      { slotNum: 1, batteryId: "BAT-A" },
      { slotNum: 3, batteryId: "BAT-C" },
      { slotNum: 4, batteryId: "BAT-D" },
    ]),
  }, status([{ slotNum: 1, batteryId: "BAT-A" }]));
  if (decision.state !== "needs_reconciliation" || decision.reason !== "MULTI_BATTERY_RELEASE_OBSERVED") {
    throw new Error(`multi-release was not blocked: ${JSON.stringify(decision)}`);
  }
  if (decision.unexpectedMissingBatteryIds.join(",") !== "BAT-C") {
    throw new Error(`missing additional battery not recorded: ${JSON.stringify(decision)}`);
  }
});

Deno.test("DTA pilot completes only when the exact battery reappears", () => {
  const decision = reconcileQualificationRun({
    state: "battery_taken",
    requested_slot_num: 2,
    expected_battery_id: "BAT-B",
    observed_battery_id: "BAT-B",
  }, status([
    { slotNum: 1, batteryId: "BAT-A" },
    { slotNum: 6, batteryId: "BAT-B" },
  ]));
  if (decision.state !== "completed" || decision.observedSlotNum !== 6) {
    throw new Error(`unexpected decision ${JSON.stringify(decision)}`);
  }
});

Deno.test("DTA pilot preserves a multi-release incident after both batteries are returned", () => {
  const run = {
    state: "needs_reconciliation",
    requested_slot_num: 4,
    expected_battery_id: "BAT-D",
    observed_battery_id: "BAT-D",
    failure_code: MULTI_BATTERY_RELEASE_OBSERVED,
    initial_snapshot: snapshot([
      { slotNum: 1, batteryId: "BAT-A" },
      { slotNum: 3, batteryId: "BAT-C" },
      { slotNum: 4, batteryId: "BAT-D" },
    ]),
  };
  const decision = reconcileQualificationRun(run, status([
    { slotNum: 1, batteryId: "BAT-A" },
    { slotNum: 3, batteryId: "BAT-C" },
    { slotNum: 4, batteryId: "BAT-D" },
  ]));
  if (decision.state !== "completed") throw new Error(`inventory should close: ${JSON.stringify(decision)}`);
  const incident = preservedMultiReleaseFailure(run);
  if (incident?.code !== MULTI_BATTERY_RELEASE_OBSERVED) {
    throw new Error(`multi-release history was lost: ${JSON.stringify(incident)}`);
  }
});

Deno.test("DTA pilot refuses to infer a cycle without exact battery identity", () => {
  const decision = reconcileQualificationRun({
    state: "battery_taken",
    requested_slot_num: 2,
    expected_battery_id: null,
    observed_battery_id: null,
  }, status([{ slotNum: 2, batteryId: "BAT-B" }]));
  if (decision.state !== "needs_reconciliation") throw new Error("identity-less cycle must fail closed");
});
