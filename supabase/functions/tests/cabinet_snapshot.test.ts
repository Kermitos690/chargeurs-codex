import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  mergeCabinetSlotObservations,
  parseChargePercent,
  parseTemperatureC,
} from "../_shared/cabinetSnapshot.ts";

Deno.test("temperature is never interpreted as state of charge", () => {
  assertEquals(parseTemperatureC({ temperature: 31.2 }), 31.2);
  assertEquals(parseChargePercent({ temperature: 31.2 }), null);
  assertEquals(parseChargePercent({ capacity: 31.2 }), null);
});

Deno.test("merged slot needs corroborated, healthy and fresh observations", () => {
  const now = new Date().toISOString();
  const [slot] = mergeCabinetSlotObservations([
    { source: "c7_batteries", timestamp: now, raw: { slotNum: 1, batteryId: "BAT-1", chargePercent: 82, temperature: 31.2, online: true, selfCheck: "pass" } },
    { source: "c8_slots", timestamp: now, raw: { slotNum: 1, batteryId: "BAT-1", present: true, canEject: true, online: true } },
  ]);
  assertEquals(slot.charge_percent, 82);
  assertEquals(slot.temperature_c, 31.2);
  assertEquals(slot.rentable, true);
  assertEquals(slot.confidence, "high");
});

Deno.test("conflicting supplier observations fail closed", () => {
  const now = new Date().toISOString();
  const [slot] = mergeCabinetSlotObservations([
    { source: "c7_batteries", timestamp: now, raw: { slotNum: 1, batteryId: "BAT-1", chargePercent: 80, online: true } },
    { source: "c8_slots", timestamp: now, raw: { slotNum: 1, batteryId: "BAT-2", present: true, canEject: true, online: true } },
  ]);
  assertEquals(slot.rentable, false);
  assertEquals(slot.customer_status, "checking");
  assertEquals(slot.conflicts.includes("battery_id"), true);
});

Deno.test("only a corroborated self-checked slot can be recommended", () => {
  const now = new Date().toISOString();
  const slots = mergeCabinetSlotObservations([
    { source: "c7_batteries", timestamp: now, raw: { slotNum: 1, batteryId: "BAT-1", chargePercent: 90, temperature: 31.2, online: true, selfCheck: "pass" } },
    { source: "c8_slots", timestamp: now, raw: { slotNum: 1, batteryId: "BAT-1", present: true, canEject: true, online: true } },
    { source: "c7_batteries", timestamp: now, raw: { slotNum: 2, batteryId: "BAT-2", chargePercent: 100, temperature: 30, online: true } },
    { source: "c8_slots", timestamp: now, raw: { slotNum: 2, batteryId: "BAT-2", present: true, canEject: true, online: true } },
  ]);
  assertEquals(slots[0].self_check, "pass");
  assertEquals(slots[1].self_check, "unknown");
  assertEquals(slots[0].rentable, true);
  // A consumer must not treat 100% from a slot without a valid self-check as
  // a recommendation merely because it is numerically larger.
  assertEquals(slots[1].charge_percent, 100);
});
