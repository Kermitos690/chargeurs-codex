import { describe, expect, it } from "vitest";
import { isKioskRentalReady } from "@/lib/kioskRentalGuard";

describe("isKioskRentalReady", () => {
  const valid = { quotePresent: true, available: 1, configured: true, slotNum: 1 };

  it("allows a rental only when all authoritative prerequisites are present", () => {
    expect(isKioskRentalReady(valid)).toBe(true);
  });

  it("fails closed when the pricing quote is missing or rejected", () => {
    expect(isKioskRentalReady({ ...valid, quotePresent: false })).toBe(false);
  });

  it("fails closed for unavailable slots or an unconfigured cabinet", () => {
    expect(isKioskRentalReady({ ...valid, available: 0 })).toBe(false);
    expect(isKioskRentalReady({ ...valid, slotNum: null })).toBe(false);
    expect(isKioskRentalReady({ ...valid, configured: null })).toBe(false);
  });
});
