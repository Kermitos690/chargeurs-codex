import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { correlateReturn, extractEjectedBattery, parseReturnIdentity } from "../_shared/returnCorrelation.ts";

const candidates = [
  { id: "r1", stationId: "DTA21269", state: "active_rental", batteryId: "BAT-001", tradeNo: "TR-001" },
  { id: "r2", stationId: "DTA21277", state: "active_rental", batteryId: "BAT-002", tradeNo: "TR-002" },
];

Deno.test("correlates an exact trade number", () => {
  assertEquals(correlateReturn({
    eventId: "e1", stationId: "DTA21269", batteryId: null, tradeNo: "TR-001", slotNum: 2,
  }, candidates), { ok: true, rentalId: "r1", matchedBy: "trade_no" });
});

Deno.test("rejects a trade number reported by another station", () => {
  assertEquals(correlateReturn({
    eventId: "e2", stationId: "DTA21277", batteryId: null, tradeNo: "TR-001", slotNum: 2,
  }, candidates), { ok: false, error: "STATION_MISMATCH" });
});

Deno.test("correlates an exact battery ID", () => {
  assertEquals(correlateReturn({
    eventId: "e3", stationId: "DTA22032", batteryId: "BAT-002", tradeNo: null, slotNum: 1,
  }, candidates), { ok: true, rentalId: "r2", matchedBy: "battery_id" });
});

Deno.test("never falls back to a single station candidate", () => {
  assertEquals(correlateReturn({
    eventId: "e4", stationId: "DTA21269", batteryId: null, tradeNo: null, slotNum: 1,
  }, candidates), { ok: false, error: "NO_IDENTITY" });
});

Deno.test("detects duplicate battery identities", () => {
  assertEquals(correlateReturn({
    eventId: "e5", stationId: null, batteryId: "BAT-001", tradeNo: null, slotNum: null,
  }, [...candidates, { id: "r3", stationId: "DTA22032", state: "ejected", batteryId: "BAT-001", tradeNo: "TR-003" }]), {
    ok: false,
    error: "AMBIGUOUS_MATCH",
  });
});

Deno.test("parses nested ChargeNow payloads", () => {
  assertEquals(parseReturnIdentity({
    messageId: "event-1",
    data: { cabinetId: "DTA21269", batterySN: "BAT-001", tradeNo: "TR-001", slotNum: "3" },
  }), {
    eventId: "event-1",
    stationId: "DTA21269",
    batteryId: "BAT-001",
    tradeNo: "TR-001",
    slotNum: 3,
  });
});

Deno.test("extracts a battery from an ejection response", () => {
  assertEquals(extractEjectedBattery({ data: { batteryCode: "BAT-009", position: 4 } }), {
    batteryId: "BAT-009",
    slotNum: 4,
  });
});
