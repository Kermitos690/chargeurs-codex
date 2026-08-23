import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  computeFinalPricingFromSnapshot,
  PricingSnapshotError,
} from "../_shared/pricingSnapshot.ts";

function snapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    pricing_rules_version: 1,
    profile_id: "11111111-1111-4111-8111-111111111111",
    profile_name: "Frozen tariff",
    profile_version: 7,
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
    unreturned_after_minutes: 0,
    min_amount_cents: 0,
    rounding: "none",
    tax_percent: 0,
    ...overrides,
  };
}

const START = "2026-07-19T10:00:00.000Z";

Deno.test("frozen snapshot bills 1.50 CHF for one hour", () => {
  const result = computeFinalPricingFromSnapshot({
    snapshot: snapshot(),
    expectedCurrency: "CHF",
    startAt: START,
    endAt: "2026-07-19T11:00:00.000Z",
    returnState: "normal",
  });
  assertEquals(result.final_cents, 150);
  assertEquals(result.billed_periods, 2);
  assertEquals(result.source, "rental_snapshot");
});

Deno.test("later live-profile changes cannot alter an existing rental snapshot", () => {
  const frozen = snapshot();
  const currentMutableProfile = { price_per_period_cents: 975, daily_cap_cents: 9900 };
  const before = computeFinalPricingFromSnapshot({
    snapshot: frozen,
    expectedCurrency: "CHF",
    startAt: START,
    endAt: "2026-07-19T12:00:00.000Z",
    returnState: "normal",
  });

  // This deliberately models an administrator changing the currently assigned
  // profile after the rental began. It is not passed to the frozen calculator.
  currentMutableProfile.price_per_period_cents = 1500;
  currentMutableProfile.daily_cap_cents = 12000;

  const after = computeFinalPricingFromSnapshot({
    snapshot: frozen,
    expectedCurrency: "CHF",
    startAt: START,
    endAt: "2026-07-19T12:00:00.000Z",
    returnState: "normal",
  });
  assertEquals(after.final_cents, 300);
  assertEquals(after.final_cents, before.final_cents);
  assertEquals(after.billed_periods, before.billed_periods);
  assertEquals(after.price_per_period_cents, before.price_per_period_cents);
});

Deno.test("non-return is exactly 99 CHF even before the daily cap is reached", () => {
  const result = computeFinalPricingFromSnapshot({
    snapshot: snapshot(),
    expectedCurrency: "CHF",
    startAt: START,
    endAt: "2026-07-19T11:00:00.000Z",
    returnState: "not_returned",
  });
  assertEquals(result.final_cents, 9900);
});

Deno.test("incomplete legacy snapshots fail closed", () => {
  const incomplete = snapshot();
  delete incomplete.price_per_period_cents;
  assertThrows(
    () => computeFinalPricingFromSnapshot({
      snapshot: incomplete,
      expectedCurrency: "CHF",
      startAt: START,
      endAt: "2026-07-19T11:00:00.000Z",
      returnState: "normal",
    }),
    PricingSnapshotError,
    "PRICING_SNAPSHOT_INVALID_PRICE_PER_PERIOD_CENTS",
  );
});

Deno.test("currency mismatch fails closed", () => {
  assertThrows(
    () => computeFinalPricingFromSnapshot({
      snapshot: snapshot({ currency: "EUR" }),
      expectedCurrency: "CHF",
      startAt: START,
      endAt: "2026-07-19T11:00:00.000Z",
      returnState: "normal",
    }),
    PricingSnapshotError,
    "PRICING_SNAPSHOT_CURRENCY_MISMATCH",
  );
});

Deno.test("settlement runtime never resolves the current pricing assignment", async () => {
  const source = await Deno.readTextFile("supabase/functions/_shared/settlementRuntime.ts");
  assertEquals(source.includes('.rpc("compute_pricing"'), false);
  assertEquals(source.includes("computeFinalPricingFromSnapshot"), true);
  assertEquals(source.includes("PRICING_SNAPSHOT_HASH_MISMATCH"), true);
});

Deno.test("Checkout rejects a missing or modified frozen snapshot before payment", async () => {
  const source = await Deno.readTextFile("supabase/functions/create-stripe-checkout/index.ts");
  const snapshotCheckAt = source.indexOf("!storedHash || await snapshotHash(snapshot) !== storedHash");
  const stripeCreateAt = source.indexOf("stripe.checkout.sessions.create");
  assert(snapshotCheckAt >= 0);
  assert(source.includes('error: "SNAPSHOT_INVALID"'));
  assert(snapshotCheckAt < stripeCreateAt);
});
