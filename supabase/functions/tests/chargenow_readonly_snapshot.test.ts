import {
  normalizePricing,
  normalizeShop,
  normalizeSlots,
  normalizeSupplementalBatteries,
} from "../_shared/chargenowReadonlySnapshot.ts";

Deno.test("normalizes the documented cabinet query shop and pricing payload", () => {
  const response = {
    code: 0,
    data: {
      priceStrategy: {
        priceId: 12,
        depositAmount: 30,
        priceMinute: 30,
        timeoutAmount: 99,
        timeoutDay: 3,
        dailyMaxPrice: 18,
        freeMinutes: 0,
        currencySymbol: "CHF",
        price: 0.75,
        name: "Chargeurs.ch standard",
        shopId: "shop-lausanne",
      },
      shop: {
        id: "shop-lausanne",
        name: "Pilote Lausanne",
        address: "Lausanne",
        latitude: "46.5197",
        longitude: "6.6323",
      },
    },
  };

  const shop = normalizeShop(response);
  const pricing = normalizePricing(response);

  if (shop.id !== "shop-lausanne" || shop.name !== "Pilote Lausanne") {
    throw new Error(`Unexpected shop normalization: ${JSON.stringify(shop)}`);
  }
  if (pricing.depositAmount !== 30 || pricing.price !== 0.75 || pricing.priceMinute !== 30) {
    throw new Error(`Unexpected pricing normalization: ${JSON.stringify(pricing)}`);
  }
  if (pricing.dailyMaxPrice !== 18 || pricing.timeoutAmount !== 99 || pricing.currency !== "CHF") {
    throw new Error(`Unexpected pricing limits: ${JSON.stringify(pricing)}`);
  }
});

Deno.test("normalizes supplemental battery and slot lists without duplicates", () => {
  const batteries = normalizeSupplementalBatteries({
    code: 0,
    data: {
      list: [
        { batteryId: "BAT-1", slotNum: 1, vol: 92 },
        { batteryId: "BAT-1", slotNum: 1, vol: 92 },
        { batterySn: "BAT-2", slot: "2", capacity: "81" },
      ],
    },
  });
  const slots = normalizeSlots({
    data: {
      slotList: [
        { slotNum: 2, status: "occupied", batteryId: "BAT-2" },
        { slotNum: 1, status: "occupied", batteryId: "BAT-1" },
        { slotNum: 3, status: "empty" },
      ],
    },
  });

  if (batteries.length !== 2 || batteries[0].batteryId !== "BAT-1" || batteries[1].powerLevel !== 81) {
    throw new Error(`Unexpected batteries: ${JSON.stringify(batteries)}`);
  }
  if (slots.map((slot) => slot.slotNum).join(",") !== "1,2,3") {
    throw new Error(`Slots were not sorted: ${JSON.stringify(slots)}`);
  }
  if (slots[2].batteryId !== null || slots[2].status !== "empty") {
    throw new Error(`Unexpected empty slot: ${JSON.stringify(slots[2])}`);
  }
});

Deno.test("does not invent missing provider values", () => {
  const shop = normalizeShop({ code: 0, data: {} });
  const pricing = normalizePricing({ code: 0, data: {} });
  const batteries = normalizeSupplementalBatteries({ code: 0, data: {} });
  const slots = normalizeSlots({ code: 0, data: {} });

  if (Object.values(shop).some((value) => value !== null)) {
    throw new Error(`Shop values must remain null: ${JSON.stringify(shop)}`);
  }
  if (Object.values(pricing).some((value) => value !== null)) {
    throw new Error(`Pricing values must remain null: ${JSON.stringify(pricing)}`);
  }
  if (batteries.length !== 0 || slots.length !== 0) {
    throw new Error("Missing arrays must remain empty");
  }
});
