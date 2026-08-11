import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classifyRentalCandidates,
  selectPhysicalReturnEvidence,
} from "../_shared/returnCorrelation.ts";

const callbackSource = await Deno.readTextFile(
  new URL("../chargenow-rent-callback/index.ts", import.meta.url),
);

Deno.test("same contractual battery returned to a different slot is accepted", () => {
  const evidence = selectPhysicalReturnEvidence([
    {
      receivedAt: "2026-08-11T06:42:00.000Z",
      externalEventId: "battery-in-slot-1",
      batteryId: "F0F000503E",
      slotNum: 1,
    },
  ], "F0F000503E");

  assert(evidence);
  assertEquals(evidence.returnedSlotNum, 1);
  assertEquals(evidence.externalEventId, "battery-in-slot-1");
  assert(!callbackSource.includes("observedSlot === slotNum"), "return correlation must not require the departure slot");
  assert(callbackSource.includes("selected_slot_num: session.selected_slot_num ?? null"));
  assert(callbackSource.includes("returned_slot_num: returnedSlotNum"));
});

Deno.test("wrong physical battery is refused", () => {
  const evidence = selectPhysicalReturnEvidence([
    {
      receivedAt: "2026-08-11T06:42:00.000Z",
      externalEventId: "wrong-battery",
      batteryId: "EXTRA-BATTERY",
      slotNum: 1,
    },
  ], "F0F000503E");

  assertEquals(evidence, null);
  assert(callbackSource.includes("RETURN_BATTERY_MISMATCH"));
});

Deno.test("BATTERY_IN without an observed return slot is not physical return proof", () => {
  const evidence = selectPhysicalReturnEvidence([
    {
      receivedAt: "2026-08-11T06:42:00.000Z",
      externalEventId: "missing-slot",
      batteryId: "F0F000503E",
      slotNum: null,
    },
  ], "F0F000503E");

  assertEquals(evidence, null);
});

Deno.test("missing BATTERY_IN cannot synthesize returned_at or trigger settlement", () => {
  assert(!callbackSource.includes("physical?.receivedAt ?? new Date().toISOString()"));
  const lookup = callbackSource.indexOf("const physical = await physicalReturnTime");
  const guard = callbackSource.indexOf("if (!physical)", lookup);
  const guardEnd = callbackSource.indexOf("const returnedAt = physical.receivedAt", guard);
  const block = callbackSource.slice(guard, guardEnd);

  assert(lookup >= 0);
  assert(guard > lookup);
  assert(block.includes("RETURN_PHYSICAL_EVIDENCE_MISSING"));
  assert(block.includes("settlement_triggered: false"));
  assertEquals(block.includes("triggerSettlement("), false);
  assertEquals(block.includes('state: "battery_returned"'), false);
  assertEquals(block.includes('status: "in_station"'), false);
});

Deno.test("multiple active rentals for the same battery fail closed before trade fallback", () => {
  assertEquals(classifyRentalCandidates(2), "ambiguous");
  assertEquals(classifyRentalCandidates(1), "unique");
  assertEquals(classifyRentalCandidates(0), "none");

  const batteryLookup = callbackSource.indexOf("uniqueActiveRentalByBattery");
  const ambiguityGuard = callbackSource.indexOf('classifyRentalCandidates(sessions.length) === "ambiguous"', batteryLookup);
  const tradeFallback = callbackSource.indexOf("if (sessions.length === 0 && parsed.tradeNo)", ambiguityGuard);
  const guardedBlock = callbackSource.slice(ambiguityGuard, tradeFallback);

  assert(batteryLookup >= 0);
  assert(ambiguityGuard > batteryLookup);
  assert(tradeFallback > ambiguityGuard);
  assert(guardedBlock.includes("AMBIGUOUS_RENTAL"));
  assert(guardedBlock.includes("settlement_triggered: false"));
});

Deno.test("different provider orderId can be controlled by unique contractual battery identity", () => {
  const uniqueBatteryLookup = callbackSource.indexOf("uniqueActiveRentalByBattery");
  const tradeFallback = callbackSource.indexOf("if (sessions.length === 0 && parsed.tradeNo)", uniqueBatteryLookup);
  assert(uniqueBatteryLookup >= 0 && tradeFallback > uniqueBatteryLookup);
  assert(callbackSource.includes("provider_order_mismatch_controlled"));
  assert(callbackSource.includes("chargenow_order_id: canonicalTradeNo || parsed.tradeNo || null"));
});

Deno.test("return callback never issues a second hardware command", () => {
  assertEquals(callbackSource.includes("ejectByRent"), false);
  assertEquals(callbackSource.includes("eject-after-payment"), false);
  assert(callbackSource.includes("automatic_retry_allowed: false"));
});

Deno.test("settlement remains scoped to the uniquely correlated rental, not an extra battery", () => {
  const settlement = callbackSource.indexOf("const settlement = await triggerSettlement(String(session.id), returnedAt)");
  assert(settlement >= 0);
  assert(callbackSource.includes('.eq("battery_id", contractualBatteryId)'));
  assertEquals(callbackSource.includes("triggerSettlement(String(extra"), false);
  assertEquals(callbackSource.includes('from("rental_sessions").insert'), false);
});
