import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { computeFinalPricingFromSnapshot, PricingSnapshotError } from "../_shared/pricingSnapshot.ts";

const START = "2026-08-15T12:00:00.000Z";

function endAt(minutes: number) {
  return new Date(Date.parse(START) + minutes * 60_000).toISOString();
}

function premiumSnapshot(): Record<string, unknown> {
  return {
    profile_id: "c4429729-b30e-4826-97a7-4d984f8d6e30",
    profile_name: "chargeur.ch Premium",
    profile_version: 3,
    pricing_rules_version: 2,
    currency: "CHF",
    tiered: true,
    tiers: [
      { upper_minutes: 30, total_cents: 190 },
      { upper_minutes: 120, total_cents: 390 },
      { upper_minutes: 360, total_cents: 590 },
      { upper_minutes: 1440, total_cents: 790 },
    ],
    initial_fee_cents: 0,
    included_minutes: 0,
    period_minutes: 1440,
    price_per_period_cents: 790,
    grace_minutes: 0,
    daily_cap_cents: 0,
    total_cap_cents: 2990,
    max_amount_cents: 2990,
    deposit_cents: 3000,
    late_fee_cents: 0,
    unreturned_fee_cents: 620,
    unreturned_after_minutes: 4320,
    min_amount_cents: 0,
    rounding: "none",
    tax_percent: 0,
  };
}

function price(minutes: number, returnState: "normal" | "not_returned" = "normal") {
  return computeFinalPricingFromSnapshot({
    snapshot: premiumSnapshot(),
    expectedCurrency: "CHF",
    startAt: START,
    endAt: endAt(minutes),
    returnState,
  });
}

Deno.test("v2 Premium Guest matches the server tier boundaries", () => {
  const vectors = [
    [0, 190],
    [1, 190],
    [30, 190],
    [31, 390],
    [120, 390],
    [121, 590],
    [360, 590],
    [361, 790],
    [1440, 790],
    [1441, 1580],
    [2881, 2370],
    [4321, 2990],
    [5761, 2990],
  ] as const;

  for (const [minutes, expectedFinal] of vectors) {
    const result = price(minutes);
    assertEquals(result.final_cents, expectedFinal, `duration ${minutes} minutes`);
  }
});

Deno.test("v2 continuation periods are measured after the last tier", () => {
  const result = price(2881);
  assertEquals(result.billed_periods, 2);
  assertEquals(result.duration_cents, 2370);
  assertEquals(result.final_cents, 2370);
});

Deno.test("v2 explicit not-returned fee is additive before caps", () => {
  const result = price(120, "not_returned");
  assertEquals(result.duration_cents, 390);
  assertEquals(result.additional_fees_cents, 620);
  assertEquals(result.subtotal_cents, 1010);
  assertEquals(result.final_cents, 1010);
});

Deno.test("v2 active threshold starts exactly at configured minute", () => {
  const result = price(4320);
  assertEquals(result.duration_cents, 2370);
  assertEquals(result.additional_fees_cents, 620);
  assertEquals(result.subtotal_cents, 2990);
  assertEquals(result.final_cents, 2990);
});

Deno.test("v2 active threshold remains capped by the immutable total cap", () => {
  const result = price(4321);
  assertEquals(result.additional_fees_cents, 620);
  assertEquals(result.final_cents, 2990);
  assertEquals(result.caps_applied, [{ type: "total", value: 2990 }]);
});

Deno.test("v2 non-tiered member pricing keeps daily cap semantics", () => {
  const snapshot = {
    ...premiumSnapshot(),
    profile_id: "member",
    profile_name: "Member",
    tiered: false,
    tiers: [],
    period_minutes: 60,
    price_per_period_cents: 75,
    daily_cap_cents: 900,
    total_cap_cents: 0,
    max_amount_cents: 0,
    deposit_cents: 0,
    unreturned_fee_cents: 0,
    unreturned_after_minutes: 0,
  };
  const result = computeFinalPricingFromSnapshot({
    snapshot,
    expectedCurrency: "CHF",
    startAt: START,
    endAt: endAt(13 * 60),
    returnState: "normal",
  });
  assertEquals(result.duration_cents, 975);
  assertEquals(result.final_cents, 900);
  assertEquals(result.caps_applied, [{ type: "daily", value: 900 }]);
});

Deno.test("v2 corrupt tier order fails closed", () => {
  const snapshot = premiumSnapshot();
  snapshot.tiers = [
    { upper_minutes: 120, total_cents: 390 },
    { upper_minutes: 30, total_cents: 190 },
  ];
  assertThrows(
    () => computeFinalPricingFromSnapshot({ snapshot, expectedCurrency: "CHF", startAt: START, endAt: endAt(60), returnState: "normal" }),
    PricingSnapshotError,
    "PRICING_SNAPSHOT_INVALID_TIERS",
  );
});

Deno.test("v2 tier flag mismatch fails closed", () => {
  const snapshot = premiumSnapshot();
  snapshot.tiered = false;
  assertThrows(
    () => computeFinalPricingFromSnapshot({ snapshot, expectedCurrency: "CHF", startAt: START, endAt: endAt(60), returnState: "normal" }),
    PricingSnapshotError,
    "PRICING_SNAPSHOT_TIER_FLAG_MISMATCH",
  );
});

Deno.test("snapshot currency and version mismatches fail closed", () => {
  assertThrows(
    () => computeFinalPricingFromSnapshot({ snapshot: premiumSnapshot(), expectedCurrency: "EUR", startAt: START, endAt: endAt(60), returnState: "normal" }),
    PricingSnapshotError,
    "PRICING_SNAPSHOT_CURRENCY_MISMATCH",
  );
  const unsupported = premiumSnapshot();
  unsupported.pricing_rules_version = 3;
  assertThrows(
    () => computeFinalPricingFromSnapshot({ snapshot: unsupported, expectedCurrency: "CHF", startAt: START, endAt: endAt(60), returnState: "normal" }),
    PricingSnapshotError,
    "PRICING_SNAPSHOT_VERSION_UNSUPPORTED",
  );
});

Deno.test("legacy v1 calculation remains unchanged", () => {
  const snapshot = {
    pricing_rules_version: 1,
    currency: "CHF",
    initial_fee_cents: 0,
    included_minutes: 0,
    period_minutes: 30,
    price_per_period_cents: 75,
    grace_minutes: 0,
    daily_cap_cents: 1800,
    total_cap_cents: 0,
    max_amount_cents: 9900,
    deposit_cents: 3000,
    late_fee_cents: 0,
    unreturned_fee_cents: 9900,
    unreturned_after_minutes: 4320,
    min_amount_cents: 0,
    rounding: "none",
    tax_percent: 0,
  };
  const result = computeFinalPricingFromSnapshot({ snapshot, expectedCurrency: "CHF", startAt: START, endAt: endAt(60), returnState: "normal" });
  assertEquals(result.final_cents, 150);
});
