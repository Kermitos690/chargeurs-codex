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
