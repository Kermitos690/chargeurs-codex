import { describe, expect, it } from "vitest";
import { isSafeKioskQuote } from "./kioskFetch";

const currentGuestQuote = {
  customer_segment: "guest",
  tiered: true,
  currency: "CHF",
  deposit_cents: 3_000,
  total_cap_cents: 3_000,
  final_cents: 190,
  tiers: [
    { upper_minutes: 30, total_cents: 190 },
    { upper_minutes: 120, total_cents: 390 },
    { upper_minutes: 360, total_cents: 590 },
    { upper_minutes: 1_440, total_cents: 790 },
  ],
};

describe("kiosk pricing safety guard", () => {
  it("accepts the current DTA21269 guest quote with a separate CHF 30 deposit", () => {
    expect(isSafeKioskQuote(currentGuestQuote)).toBe(true);
  });

  it("rejects the obsolete zero-deposit variant", () => {
    expect(isSafeKioskQuote({ ...currentGuestQuote, deposit_cents: 0 })).toBe(false);
  });

  it("still rejects a changed rental tier", () => {
    expect(isSafeKioskQuote({
      ...currentGuestQuote,
      tiers: currentGuestQuote.tiers.map((tier, index) => index === 0 ? { ...tier, total_cents: 200 } : tier),
    })).toBe(false);
  });

  it("rejects a changed rental ceiling", () => {
    expect(isSafeKioskQuote({ ...currentGuestQuote, total_cap_cents: 2_990 - 1 })).toBe(false);
  });
});
