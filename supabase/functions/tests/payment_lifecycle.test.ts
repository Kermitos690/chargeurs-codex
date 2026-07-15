import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DEFAULT_AUTHORIZATION_CENTS,
  DEFAULT_NON_RETURN_TOTAL_CENTS,
  isAuthorizationAmountAllowed,
  planSettlement,
} from "../_shared/paymentLifecycle.ts";

Deno.test("accepts exactly the configured 30 CHF authorization", () => {
  assertEquals(isAuthorizationAmountAllowed(3000), true);
  assertEquals(isAuthorizationAmountAllowed(2999), false);
  assertEquals(isAuthorizationAmountAllowed(9900), false);
});

Deno.test("captures only the returned rental amount from the authorization", () => {
  assertEquals(planSettlement({
    reason: "returned",
    authorizedCents: DEFAULT_AUTHORIZATION_CENTS,
    calculatedRentalCents: 750,
  }), {
    valid: true,
    error: null,
    finalTotalCents: 750,
    captureFromAuthorizationCents: 750,
    cancelAuthorization: false,
    additionalChargeCents: 0,
    refundCents: 0,
    terminalState: "completed",
  });
});

Deno.test("caps the first capture at the 30 CHF authorization and exposes the additional due", () => {
  const plan = planSettlement({
    reason: "non_return",
    authorizedCents: DEFAULT_AUTHORIZATION_CENTS,
    calculatedRentalCents: 1800,
  });
  assertEquals(plan.finalTotalCents, DEFAULT_NON_RETURN_TOTAL_CENTS);
  assertEquals(plan.captureFromAuthorizationCents, 3000);
  assertEquals(plan.additionalChargeCents, 6900);
  assertEquals(plan.terminalState, "needs_support");
});

Deno.test("release failure cancels an uncaptured authorization", () => {
  const plan = planSettlement({
    reason: "release_failed",
    authorizedCents: 3000,
    calculatedRentalCents: 0,
  });
  assertEquals(plan.cancelAuthorization, true);
  assertEquals(plan.captureFromAuthorizationCents, 0);
  assertEquals(plan.terminalState, "cancelled");
});

Deno.test("release failure refunds an amount already captured", () => {
  const plan = planSettlement({
    reason: "release_failed",
    authorizedCents: 3000,
    calculatedRentalCents: 0,
    capturedCents: 3000,
  });
  assertEquals(plan.cancelAuthorization, false);
  assertEquals(plan.refundCents, 3000);
  assertEquals(plan.terminalState, "refunded");
});

Deno.test("an overpayment after return produces only the remaining refund", () => {
  const plan = planSettlement({
    reason: "returned",
    authorizedCents: 3000,
    calculatedRentalCents: 750,
    capturedCents: 3000,
    refundedCents: 1000,
  });
  assertEquals(plan.refundCents, 250);
});
