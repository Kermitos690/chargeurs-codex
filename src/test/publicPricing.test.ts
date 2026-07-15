import { describe, expect, it } from "vitest";
import { estimateRentalPrice, PUBLIC_PRICING } from "@/lib/publicPricing";

describe("public Chargeurs.ch pricing", () => {
  it("uses 30 minute increments", () => {
    expect(estimateRentalPrice(1)).toBe(0.75);
    expect(estimateRentalPrice(30)).toBe(0.75);
    expect(estimateRentalPrice(31)).toBe(1.5);
    expect(estimateRentalPrice(60)).toBe(1.5);
  });

  it("applies the daily cap", () => {
    expect(estimateRentalPrice(12 * 60)).toBe(PUBLIC_PRICING.dailyCap);
    expect(estimateRentalPrice(20 * 60)).toBe(PUBLIC_PRICING.dailyCap);
  });

  it("keeps the non-return total coherent", () => {
    expect(PUBLIC_PRICING.deposit + PUBLIC_PRICING.nonReturnBalanceAfterDeposit).toBe(PUBLIC_PRICING.nonReturnTotal);
  });
});
