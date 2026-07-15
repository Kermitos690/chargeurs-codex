import { describe, expect, it } from "vitest";
import { PUBLIC_PRICING, priceForMinutes } from "@/lib/publicPricing";

describe("Chargeurs.ch public pricing", () => {
  it("keeps the validated pricing constants", () => {
    expect(PUBLIC_PRICING.depositChf).toBe(30);
    expect(PUBLIC_PRICING.hourlyRateChf).toBe(1.5);
    expect(PUBLIC_PRICING.billingStepMinutes).toBe(30);
    expect(PUBLIC_PRICING.dailyCapChf).toBe(18);
    expect(PUBLIC_PRICING.nonReturnTotalChf).toBe(99);
  });

  it("bills each started 30-minute period", () => {
    expect(priceForMinutes(1)).toBe(0.75);
    expect(priceForMinutes(30)).toBe(0.75);
    expect(priceForMinutes(31)).toBe(1.5);
    expect(priceForMinutes(60)).toBe(1.5);
  });

  it("applies the daily cap and ignores invalid duration", () => {
    expect(priceForMinutes(12 * 60)).toBe(18);
    expect(priceForMinutes(20 * 60)).toBe(18);
    expect(priceForMinutes(0)).toBe(0);
    expect(priceForMinutes(-30)).toBe(0);
  });
});
