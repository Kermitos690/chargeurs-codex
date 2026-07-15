import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  betaRentalsEnabled,
  BETA_PRICING_RULES,
  validateBetaPriceProfile,
} from "../_shared/beta-rental-gate.ts";

const validProfile = {
  active: true,
  currency: "CHF",
  period_minutes: BETA_PRICING_RULES.periodMinutes,
  price_per_period_cents: BETA_PRICING_RULES.pricePerPeriodCents,
  daily_cap_cents: BETA_PRICING_RULES.dailyCapCents,
  deposit_cents: BETA_PRICING_RULES.depositCents,
  unreturned_fee_cents: BETA_PRICING_RULES.unreturnedTotalCents,
  max_amount_cents: BETA_PRICING_RULES.unreturnedTotalCents,
};

Deno.test("beta rentals are disabled unless explicitly enabled", () => {
  assertEquals(betaRentalsEnabled(() => undefined), false);
  assertEquals(betaRentalsEnabled(() => "false"), false);
  assertEquals(betaRentalsEnabled(() => "true"), true);
});

Deno.test("confirmed beta pricing profile is accepted", () => {
  assertEquals(validateBetaPriceProfile(validProfile), null);
});

Deno.test("legacy 0.50 CHF profile is rejected", () => {
  assertEquals(validateBetaPriceProfile({
    ...validProfile,
    price_per_period_cents: 50,
    deposit_cents: 0,
    daily_cap_cents: 0,
    unreturned_fee_cents: 0,
    max_amount_cents: 0,
  }), "PRICING_RATE_INVALID");
});

Deno.test("each critical financial rule is fail-closed", () => {
  assertEquals(validateBetaPriceProfile({ ...validProfile, active: false }), "PRICING_PROFILE_INACTIVE");
  assertEquals(validateBetaPriceProfile({ ...validProfile, currency: "EUR" }), "PRICING_CURRENCY_INVALID");
  assertEquals(validateBetaPriceProfile({ ...validProfile, period_minutes: 60 }), "PRICING_PERIOD_INVALID");
  assertEquals(validateBetaPriceProfile({ ...validProfile, daily_cap_cents: 0 }), "PRICING_DAILY_CAP_INVALID");
  assertEquals(validateBetaPriceProfile({ ...validProfile, deposit_cents: 0 }), "PRICING_DEPOSIT_INVALID");
  assertEquals(validateBetaPriceProfile({ ...validProfile, unreturned_fee_cents: 6_900 }), "PRICING_UNRETURNED_TOTAL_INVALID");
  assertEquals(validateBetaPriceProfile({ ...validProfile, max_amount_cents: 0 }), "PRICING_MAXIMUM_INVALID");
});
