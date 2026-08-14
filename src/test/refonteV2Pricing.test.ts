import { describe, expect, it } from "vitest";
import { PUBLIC_PRICING, priceForMinutes } from "@/lib/publicPricing";

describe("Chargeurs.ch public pricing", () => {
  it("keeps the validated pricing constants", () => {
    expect(PUBLIC_PRICING.depositChf).toBe(0);
    expect(PUBLIC_PRICING.startingPriceChf).toBe(1.9);
    expect(PUBLIC_PRICING.dailyCapChf).toBe(7.9);
    expect(PUBLIC_PRICING.nonReturnTotalChf).toBe(29.9);
  });

  it("bills each started 30-minute period", () => {
    expect(priceForMinutes(1)).toBe(1.9);
    expect(priceForMinutes(30)).toBe(1.9);
    expect(priceForMinutes(31)).toBe(3.9);
    expect(priceForMinutes(120)).toBe(3.9);
    expect(priceForMinutes(121)).toBe(5.9);
  });

  it("applies the daily cap and ignores invalid duration", () => {
    expect(priceForMinutes(24 * 60)).toBe(7.9);
    expect(priceForMinutes(24 * 60 + 1)).toBe(15.8);
    expect(priceForMinutes(0)).toBe(0);
    expect(priceForMinutes(-30)).toBe(0);
  });
});
