import { describe, expect, it } from "vitest";
import { estimateRentalPrice, PUBLIC_PRICING } from "@/lib/publicPricing";

describe("public Chargeurs.ch pricing", () => {
  it("uses 30 minute increments", () => {
    expect(estimateRentalPrice(1)).toBe(1.9);
    expect(estimateRentalPrice(30)).toBe(1.9);
    expect(estimateRentalPrice(31)).toBe(3.9);
    expect(estimateRentalPrice(120)).toBe(3.9);
    expect(estimateRentalPrice(121)).toBe(5.9);
    expect(estimateRentalPrice(360)).toBe(5.9);
    expect(estimateRentalPrice(361)).toBe(7.9);
  });

  it("applies the daily cap", () => {
    expect(estimateRentalPrice(24 * 60)).toBe(PUBLIC_PRICING.dailyCap);
    expect(estimateRentalPrice(24 * 60 + 1)).toBe(15.8);
  });

  it("keeps the non-return total coherent", () => {
    expect(PUBLIC_PRICING.deposit + PUBLIC_PRICING.nonReturnBalanceAfterDeposit).toBe(PUBLIC_PRICING.nonReturnTotal);
  });
});
