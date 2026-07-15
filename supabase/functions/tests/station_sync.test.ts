import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseCabinetState } from "../_shared/stationSync.ts";

Deno.test("parses documented ChargeNow cabinet payload", () => {
  const result = parseCabinetState({
    data: {
      cabinet: { online: true, slots: 8, emptySlots: 5, signal: 82 },
      batteries: [
        { slotNum: 1, batteryId: "BAT-1", vol: 94 },
        { slotNum: 4, batteryId: "BAT-2", vol: 71 },
        { slotNum: 8, batteryId: "BAT-3", vol: 52 },
      ],
    },
  });

  assertEquals(result.online, true);
  assertEquals(result.total, 8);
  assertEquals(result.rentable, 3);
  assertEquals(result.returnable, 5);
  assertEquals(result.signal, 82);
  assertEquals(result.batteries.map((battery) => battery.slotNum), [1, 4, 8]);
  assertEquals(result.batteries[0].batteryId, "BAT-1");
});

Deno.test("accepts alternate slot and battery field names", () => {
  const result = parseCabinetState({
    cabinet: { onlineStatus: 1, totalSlots: 4 },
    slots: [
      { slot: 2, sn: "ALT-2", electricity: 66 },
      { slotId: 3, bid: "ALT-3", power: 44 },
      { slot: 4 },
    ],
  });

  assertEquals(result.online, true);
  assertEquals(result.total, 4);
  assertEquals(result.rentable, 2);
  assertEquals(result.returnable, 2);
  assertEquals(result.batteries[0].powerLevel, 66);
  assertEquals(result.batteries[1].powerLevel, 44);
});

Deno.test("fails safely on empty or malformed numeric values", () => {
  const result = parseCabinetState({ cabinet: { status: "offline", slots: "invalid", emptySlots: -3 } });
  assertEquals(result.online, false);
  assertEquals(result.total, 0);
  assertEquals(result.rentable, 0);
  assertEquals(result.returnable, 0);
  assertEquals(result.batteries, []);
});
