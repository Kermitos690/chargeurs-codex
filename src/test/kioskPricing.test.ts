import { describe, expect, it } from "vitest";
import { hourlyRateCents } from "@/lib/kioskPricing";

describe("hourlyRateCents", () => {
  it("derives the hourly rate from the authoritative period tariff", () => {
    expect(hourlyRateCents(75, 30)).toBe(150);
  });
  it("does not invent a rate for invalid pricing", () => {
    expect(hourlyRateCents(75, 0)).toBeNull();
  });
});
