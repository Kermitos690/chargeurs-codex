import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  mergeCabinetSlotObservations,
  parseChargePercent,
  parseFault,
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
  assertEquals(parseChargePercent({ vol: 3120 }), null);
  assertEquals(parseChargePercent({ vol: 31.2, temperature: 31.2 }), null);
});

Deno.test("real advanced ChargeNow charge and temperature fields stay separate", () => {
  assertEquals(parseChargePercent({ pDianliang: 84, pTemperature: 25 }), 84);
  assertEquals(parseTemperatureC({ pDianliang: 84, pTemperature: 25 }), 25);
  assertEquals(parseChargePercent({ pTemperature: 31.2 }), null);
});

Deno.test("ChargeNow zero error/fault codes are non-blocking", () => {
  assertEquals(parseFault({ pErrid: 0, pFaultType: 0, pFaultCause: "" }), {
    error_code: null,
    fault_type: null,
    fault_cause: null,
  });
  assertEquals(parseFault({ pErrid: 7, pFaultType: 2, pFaultCause: "motor" }), {
    error_code: "7",
    fault_type: "2",
    fault_cause: "motor",
  });
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

Deno.test("real C4 C7 C8 and O1 field names reconcile the same physical battery", () => {
  const now = new Date().toISOString();
  const slots = mergeCabinetSlotObservations([
    {
      source: "c4_detail",
      timestamp: now,
      raw: {
        cabinet: {
          batcabs: [
            { pKakou: 1, pBatteryid: "FECA02C714", pDianliang: 84, pErrid: 0, pFaultType: 0, pFaultCause: "" },
          ],
        },
      },
    },
    {
      source: "c7_batteries",
      timestamp: now,
      raw: {
        data: [
          { pKakou: 1, pBatteryid: "FECA02C714", pDianliang: 84, pTemperature: 25, pInfostatus: "在线", pErrid: 0, pFaultType: 0 },
        ],
      },
    },
    {
      source: "c8_slots",
      timestamp: now,
      raw: {
        data: [
          { pKakou: 1, pBatteryid: "FECA02C714", pDianliang: 84, pErrid: 0, pFaultType: 0, pFaultCause: "" },
        ],
      },
    },
    {
      source: "o1_query",
      timestamp: now,
      raw: {
        data: {
          cabinet: { online: true },
          batteries: [{ slotNum: 1, batteryId: "FECA02C714", vol: 84 }],
        },
      },
    },
  ]);

  const slot = slots[0];
  assertEquals(slot.battery_id, "FECA02C714");
  assertEquals(slot.charge_percent, 84);
  assertEquals(slot.temperature_c, 25);
  assertEquals(slot.online, true);
  assertEquals(slot.conflicts, []);
  assertEquals(slot.confidence, "high");
  assertEquals(slot.rentable, true);
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

Deno.test("a non-zero battery below the default rental threshold remains in charging state", () => {
  const now = new Date().toISOString();
  const slots = mergeCabinetSlotObservations([
    { source: "c7_batteries", timestamp: now, raw: { pKakou: 2, pBatteryid: "BAT-LOW", pDianliang: 14, pTemperature: 28, pInfostatus: "在线", pErrid: 0, pFaultType: 0 } },
    { source: "c8_slots", timestamp: now, raw: { pKakou: 2, pBatteryid: "BAT-LOW", pDianliang: 14, pErrid: 0, pFaultType: 0 } },
  ]);
  assertEquals(slots[1].charge_percent, 14);
  assertEquals(slots[1].rentable, false);
  assertEquals(slots[1].customer_status, "charging");
  assertEquals(slots[1].diagnostic_flags.includes("charge_below_rental_threshold"), true);
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

Deno.test("only a corroborated self-checked slot can be preferred by stricter recommendation logic", () => {
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
  assertEquals(slots[1].charge_percent, 100);
});
