import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { computeFinalPricingFromSnapshot } from "../_shared/pricingSnapshot.ts";

const START = "2026-08-27T00:00:00.000Z";

function endAt(minutes: number) {
  return new Date(Date.parse(START) + minutes * 60_000).toISOString();
}

function expressSnapshot(): Record<string, unknown> {
  return {
    profile_id: "express-v3",
    profile_name: "chargeur.ch Premium",
    profile_version: 5,
    pricing_rules_version: 3,
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
    total_cap_cents: 3000,
    max_amount_cents: 3000,
    deposit_cents: 3000,
    late_fee_cents: 0,
    unreturned_fee_cents: 3000,
    unreturned_after_minutes: 4320,
    min_amount_cents: 0,
    rounding: "none",
    tax_percent: 0,
  };
}

function memberSnapshot(): Record<string, unknown> {
  return {
    profile_id: "member-v3-final",
    profile_name: "Chargeurs.ch Client",
    profile_version: 6,
    pricing_rules_version: 3,
    currency: "CHF",
    tiered: false,
    tiers: [],
    initial_fee_cents: 100,
    included_minutes: 60,
    period_minutes: 60,
    price_per_period_cents: 100,
    grace_minutes: 0,
    daily_cap_cents: 590,
    total_cap_cents: 3000,
    max_amount_cents: 3000,
    deposit_cents: 3000,
    late_fee_cents: 0,
    unreturned_fee_cents: 3000,
    unreturned_after_minutes: 4320,
    min_amount_cents: 200,
    rounding: "none",
    tax_percent: 0,
  };
}

function price(snapshot: Record<string, unknown>, minutes: number, returnState: "normal" | "not_returned" = "normal") {
  return computeFinalPricingFromSnapshot({
    snapshot,
    expectedCurrency: "CHF",
    startAt: START,
    endAt: endAt(minutes),
    returnState,
  });
}

Deno.test("v3 Express keeps the approved public tiers unchanged", () => {
  const vectors = [
    [1, 190],
    [30, 190],
    [31, 390],
    [120, 390],
    [121, 590],
    [360, 590],
    [361, 790],
    [1440, 790],
    [1441, 1580],
  ] as const;
  for (const [minutes, expected] of vectors) {
    assertEquals(price(expressSnapshot(), minutes).final_cents, expected, `${minutes} minutes`);
  }
});

Deno.test("v3 member pricing is CHF 2 through 2h then CHF 1 per started additional hour", () => {
  const vectors = [
    [0, 200],
    [1, 200],
    [30, 200],
    [60, 200],
    [61, 200],
    [120, 200],
    [121, 300],
    [180, 300],
    [181, 400],
    [240, 400],
    [241, 500],
    [300, 500],
    [301, 590],
    [360, 590],
    [1440, 590],
  ] as const;
  for (const [minutes, expected] of vectors) {
    assertEquals(price(memberSnapshot(), minutes).final_cents, expected, `${minutes} minutes`);
  }
});

Deno.test("v3 member daily cap scales by elapsed 24h periods before non-return", () => {
  assertEquals(price(memberSnapshot(), 1440).final_cents, 590);
  assertEquals(price(memberSnapshot(), 1441).final_cents, 1180);
  assertEquals(price(memberSnapshot(), 4319).final_cents, 1770);
});

Deno.test("v3 non-return is exactly CHF 30 total at 72h for Express", () => {
  const result = price(expressSnapshot(), 4320);
  assertEquals(result.duration_cents, 2370);
  assertEquals(result.additional_fees_cents, 630);
  assertEquals(result.final_cents, 3000);
  assertEquals(result.non_return_total_applied, true);
  assertEquals(result.caps_applied, [{ type: "non_return_total", value: 3000 }]);
});

Deno.test("v3 non-return is exactly CHF 30 total at 72h for prepaid member", () => {
  const result = price(memberSnapshot(), 4320);
  assertEquals(result.final_cents, 3000);
  assertEquals(result.non_return_total_applied, true);
  assertEquals(result.caps_applied, [{ type: "non_return_total", value: 3000 }]);
});

Deno.test("v3 explicit non-return outcome uses the same CHF 30 contractual total", () => {
  const express = price(expressSnapshot(), 120, "not_returned");
  const member = price(memberSnapshot(), 120, "not_returned");
  assertEquals(express.final_cents, 3000);
  assertEquals(member.final_cents, 3000);
});
