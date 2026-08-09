import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  mergeCabinetSlotObservations,
  parseChargePercent,
  parseTemperatureC,
  parseVoltage,
} from "../_shared/cabinetSnapshot.ts";

Deno.test("temperature is never interpreted as state of charge", () => {
  assertEquals(parseTemperatureC({ temperature: 31.2 }), 31.2);
  assertEquals(parseChargePercent({ temperature: 31.2 }), null);
  assertEquals(parseChargePercent({ capacity: 31.2 }), null);
  assertEquals(parseVoltage({ voltage: 3.82, vol: 82 }), 3.82);
});

Deno.test("confirmed ChargeNow DTA vol is interpreted as a percentage only in the valid range", () => {
  assertEquals(parseChargePercent({ vol: 77 }), 77);
  assertEquals(parseChargePercent({ vol: "36" }), 36);
  assertEquals(parseChargePercent({ vol: 0 }), 0);
  // A voltage-like or malformed value is never surfaced as a percentage.
  assertEquals(parseChargePercent({ vol: 3120 }), null);
  assertEquals(parseChargePercent({ vol: 31.2, temperature: 31.2 }), null);
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

Deno.test("a battery without an explicit charge percentage is never customer-ready", () => {
  const now = new Date().toISOString();
  const [slot] = mergeCabinetSlotObservations([
    // 31.2 is an explicit temperature, not 31.2% charge.
    { source: "c7_batteries", timestamp: now, raw: { slotNum: 1, batteryId: "BAT-1", temperature: 31.2, online: true } },
    { source: "c8_slots", timestamp: now, raw: { slotNum: 1, batteryId: "BAT-1", present: true, canEject: true, online: true } },
  ]);
  assertEquals(slot.charge_percent, null);
  assertEquals(slot.rentable, false);
  assertEquals(slot.customer_status, "checking");
});

Deno.test("a confirmed 0% ChargeNow battery is a technical issue, never rentable or charging", () => {
  const now = new Date().toISOString();
  const slots = mergeCabinetSlotObservations([
    { source: "c7_batteries", timestamp: now, raw: { slotNum: 3, batteryId: "BAT-3", vol: 0, online: true } },
    { source: "c8_slots", timestamp: now, raw: { slotNum: 3, batteryId: "BAT-3", present: true, canEject: true, online: true } },
  ]);
  const slot = slots[2];
  assertEquals(slot.charge_percent, 0);
  assertEquals(slot.rentable, false);
  assertEquals(slot.customer_status, "technical_issue");
  assertEquals(slot.diagnostic_flags, ["zero_charge_reported"]);
});

Deno.test("an explicitly empty compartment is available for return, not an alert or a battery", () => {
  const now = new Date().toISOString();
  const slots = mergeCabinetSlotObservations([
    { source: "c8_slots", timestamp: now, raw: { slotNum: 4, present: false, canEject: false, online: true, vol: 1 } },
  ]);
  const slot = slots[3];
  assertEquals(slot.battery_present, false);
  assertEquals(slot.rentable, false);
  assertEquals(slot.customer_status, "return_available");
  assertEquals(slot.diagnostic_flags, []);
});

Deno.test("a supplier-declared empty C8 slot is a return location even when only its battery field is blank", () => {
  const now = new Date().toISOString();
  const slots = mergeCabinetSlotObservations([
    { source: "c8_slots", timestamp: now, raw: { slotNum: 4, batteryId: null, canEject: false, online: true } },
  ]);
  assertEquals(slots[3].battery_present, false);
  assertEquals(slots[3].customer_status, "return_available");
});

Deno.test("an explicitly present 0% battery is a technical issue even before its identifier is available", () => {
  const now = new Date().toISOString();
  const slots = mergeCabinetSlotObservations([
    { source: "c7_batteries", timestamp: now, raw: { slotNum: 3, vol: 0, online: true } },
    { source: "c8_slots", timestamp: now, raw: { slotNum: 3, present: true, canEject: true, online: true } },
  ]);
  assertEquals(slots[2].battery_id, null);
  assertEquals(slots[2].customer_status, "technical_issue");
  assertEquals(slots[2].rentable, false);
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
