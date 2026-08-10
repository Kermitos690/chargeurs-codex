import { describe, expect, it } from "vitest";
import { computeFinalPricingFromSnapshot } from "../supabase/functions/_shared/pricingSnapshot";
import { planSettlement } from "../supabase/functions/_shared/settlement";

const snapshot = {
  profile_id: "test-profile",
  profile_name: "Chargeurs.ch Pilote",
  profile_version: 2,
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
  unreturned_after_minutes: 0,
  min_amount_cents: 0,
  rounding: "none",
  tax_percent: 0,
};

const start = "2026-08-10T12:07:58.448Z";

function priceAt(end: string, returnState: "normal" | "not_returned" = "normal") {
  return computeFinalPricingFromSnapshot({
    snapshot,
    expectedCurrency: "CHF",
    startAt: start,
    endAt: end,
    returnState,
  });
}

describe("Chargeurs.ch frozen rental pricing", () => {
  it("bills exactly one 30 minute period at 0.75 CHF", () => {
    const result = priceAt("2026-08-10T12:37:58.448Z");
    expect(result.total_minutes).toBe(30);
    expect(result.billed_periods).toBe(1);
    expect(result.final_cents).toBe(75);
  });

  it("rounds 31 minutes up to two periods", () => {
    const result = priceAt("2026-08-10T12:38:58.448Z");
    expect(result.total_minutes).toBe(31);
    expect(result.billed_periods).toBe(2);
    expect(result.final_cents).toBe(150);
  });

  it("locks the physical 10 Aug 2026 test: 5h33 = 12 periods = 9.00 CHF", () => {
    const result = priceAt("2026-08-10T17:40:56.339Z");
    expect(result.total_minutes).toBe(333);
    expect(result.billed_periods).toBe(12);
    expect(result.period_minutes).toBe(30);
    expect(result.price_per_period_cents).toBe(75);
    expect(result.final_cents).toBe(900);
  });

  it("applies the 18 CHF daily cap to an ordinary 24h rental", () => {
    const result = priceAt("2026-08-11T12:07:58.448Z");
    expect(result.total_minutes).toBe(1440);
    expect(result.final_cents).toBe(1800);
    expect(result.caps_applied).toEqual([{ type: "daily", value: 1800 }]);
  });

  it("uses 99 CHF as the contractual non-return outcome instead of the ordinary daily cap", () => {
    const result = priceAt("2026-08-10T17:40:56.339Z", "not_returned");
    expect(result.final_cents).toBe(9900);
    expect(result.return_state).toBe("not_returned");
  });
});

describe("Chargeurs.ch settlement planning", () => {
  it("captures only 9 CHF from a 30 CHF manual authorization", () => {
    const plan = planSettlement({
      strategy: "manual_capture",
      finalAmountCents: 900,
      depositAmountCents: 3000,
      amountCapturableCents: 3000,
      amountCapturedCents: 0,
      amountAlreadyRefundedCents: 0,
    });
    expect(plan.captureCents).toBe(900);
    expect(plan.refundCents).toBe(0);
    expect(plan.supplementalCents).toBe(0);
    expect(plan.cancelAuthorization).toBe(false);
    expect(plan.actions).toEqual(["capture"]);
  });

  it("refunds 21 CHF when a 30 CHF prepaid method settles at 9 CHF", () => {
    const plan = planSettlement({
      strategy: "prepaid_refund",
      finalAmountCents: 900,
      depositAmountCents: 3000,
      amountCapturedCents: 3000,
      amountAlreadyRefundedCents: 0,
    });
    expect(plan.captureCents).toBe(0);
    expect(plan.refundCents).toBe(2100);
    expect(plan.supplementalCents).toBe(0);
    expect(plan.actions).toEqual(["refund"]);
  });
});
