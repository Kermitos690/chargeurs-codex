import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseChargeNowCabinetStatus } from "../_shared/chargenowStatus.ts";

Deno.test("ChargeNow status parser accepts documented boolean fields", () => {
  const parsed = parseChargeNowCabinetStatus({
    code: 0,
    data: {
      cabinet: { online: true, slots: 4, emptySlots: 0, signal: 43 },
      batteries: [{ slotNum: 1, batteryId: "BAT-1", vol: 91 }],
    },
  });

  assertEquals(parsed.recognized, true);
  assertEquals(parsed.online, true);
  assertEquals(parsed.totalCount, 4);
  assertEquals(parsed.rentableCount, 1);
  assertEquals(parsed.returnableCount, 0);
  assertEquals(parsed.signal, 43);
  assertEquals(parsed.batteries[0].slotNum, 1);
  assertEquals(parsed.batteries[0].batteryId, "BAT-1");
});

Deno.test("ChargeNow status parser preserves provider shop identity", () => {
  const parsed = parseChargeNowCabinetStatus({
    code: 0,
    data: {
      cabinet: { id: "DTA21269", shopId: "SHOP-1", online: true, slots: 4 },
      shop: { id: "SHOP-1", name: "Test Shop", address: "Rte de Berne 222" },
      batteries: [],
    },
  });

  assertEquals(parsed.providerShopId, "SHOP-1");
  assertEquals(parsed.providerShopName, "Test Shop");
  assertEquals(parsed.providerShopAddress, "Rte de Berne 222");
});

Deno.test("ChargeNow status parser accepts numeric/string provider values", () => {
  const parsed = parseChargeNowCabinetStatus({
    code: "0",
    data: {
      online: 1,
      slotNum: "4",
      emptySlots: "0",
      signal: "43",
      batteries: [
        { slot: "1", sn: "BAT-1" },
        { slot: "2", sn: "BAT-2" },
        { slot: "3", sn: "BAT-3" },
        { slot: "4", sn: "BAT-4" },
      ],
    },
  });

  assertEquals(parsed.recognized, true);
  assertEquals(parsed.online, true);
  assertEquals(parsed.totalCount, 4);
  assertEquals(parsed.rentableCount, 4);
  assertEquals(parsed.returnableCount, 0);
  assertEquals(parsed.signal, 43);
});

Deno.test("ChargeNow status parser unwraps alternate response shapes", () => {
  const parsed = parseChargeNowCabinetStatus({
    result: {
      deviceInfo: { status: "connected", totalSlots: 8, emptySlotNum: 3 },
      batteryList: [{ slotId: 2, batterySn: "BAT-B", soc: 88 }],
    },
  });

  assertEquals(parsed.online, true);
  assertEquals(parsed.totalCount, 8);
  assertEquals(parsed.rentableCount, 1);
  assertEquals(parsed.returnableCount, 3);
  assertEquals(parsed.batteries[0].powerLevel, 88);
});

Deno.test("ChargeNow status parser distinguishes offline from unknown", () => {
  const offline = parseChargeNowCabinetStatus({
    data: { cabinet: { status: "offline", slots: 4 }, batteries: [] },
  });
  assertEquals(offline.recognized, true);
  assertEquals(offline.online, false);
  assertEquals(offline.returnableCount, 4);

  const unknown = parseChargeNowCabinetStatus({ code: 0, data: { message: "ok" } });
  assertEquals(unknown.recognized, false);
  assertEquals(unknown.online, null);
  assertEquals(unknown.totalCount, null);
});
