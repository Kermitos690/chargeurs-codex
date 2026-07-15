import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { correlateReturn, extractEjectedBattery, parseReturnIdentity } from "../_shared/returnCorrelation.ts";

Deno.test("parses nested ChargeNow return identity", () => {
  const identity = parseReturnIdentity({
    eventType: "BATTERY_IN",
    data: { deviceId: "DTA21269", batteryId: "BAT-42", slotNum: "3", messageId: "evt-1" },
  });
  assertEquals(identity, {
    eventId: "evt-1",
    stationId: "DTA21269",
    batteryId: "BAT-42",
    tradeNo: null,
    slotNum: 3,
  });
});

Deno.test("correlates return by trade number before station fallback", () => {
  const result = correlateReturn(
    { eventId: "1", stationId: "DTA21269", batteryId: null, tradeNo: "T-2", slotNum: null },
    [
      { id: "r1", stationId: "DTA21269", state: "active_rental", batteryId: null, tradeNo: "T-1" },
      { id: "r2", stationId: "DTA21269", state: "active_rental", batteryId: null, tradeNo: "T-2" },
    ],
  );
  assertEquals(result, { ok: true, rentalId: "r2", matchedBy: "trade_no" });
});

Deno.test("correlates return by exact battery id", () => {
  const result = correlateReturn(
    { eventId: "2", stationId: "DTA22032", batteryId: "BAT-9", tradeNo: null, slotNum: 2 },
    [
      { id: "r1", stationId: "DTA21269", state: "active_rental", batteryId: "BAT-9", tradeNo: null },
    ],
  );
  assertEquals(result, { ok: true, rentalId: "r1", matchedBy: "battery_id" });
});

Deno.test("refuses ambiguous station-only return", () => {
  const result = correlateReturn(
    { eventId: "3", stationId: "DTA21269", batteryId: null, tradeNo: null, slotNum: null },
    [
      { id: "r1", stationId: "DTA21269", state: "active_rental", batteryId: null, tradeNo: null },
      { id: "r2", stationId: "DTA21269", state: "battery_taken", batteryId: null, tradeNo: null },
    ],
  );
  assertEquals(result, { ok: false, error: "AMBIGUOUS_MATCH" });
});

Deno.test("ignores terminal candidates", () => {
  const result = correlateReturn(
    { eventId: "4", stationId: "DTA21269", batteryId: "BAT-1", tradeNo: null, slotNum: null },
    [
      { id: "r1", stationId: "DTA21269", state: "closed", batteryId: "BAT-1", tradeNo: null },
    ],
  );
  assertEquals(result, { ok: false, error: "NO_MATCH" });
});

Deno.test("extracts battery and slot from ejection response", () => {
  assertEquals(extractEjectedBattery({ data: { batterySN: "SN-7", position: 4 } }), {
    batteryId: "SN-7",
    slotNum: 4,
  });
});
