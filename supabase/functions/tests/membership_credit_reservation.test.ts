import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  shouldReverseMembershipCreditReservation,
  stripeAmountAfterMembershipCredit,
} from "../_shared/membershipCreditReservation.ts";

Deno.test("membership credit lowers only the final rental amount", () => {
  assertEquals(stripeAmountAfterMembershipCredit(2990, 1000), 1990);
  assertEquals(stripeAmountAfterMembershipCredit(1000, 1000), 0);
  assertThrows(() => stripeAmountAfterMembershipCredit(1000, 1001), Error, "MEMBERSHIP_CREDIT_RESERVATION_INVALID");
});

Deno.test("only a reservation before any Stripe side effect is automatically reversed", () => {
  assertEquals(shouldReverseMembershipCreditReservation({ reservedCreditCents: 1000, stripeSideEffectStarted: false, creditCommitted: false }), true);
  assertEquals(shouldReverseMembershipCreditReservation({ reservedCreditCents: 1000, stripeSideEffectStarted: true, creditCommitted: false }), false);
  assertEquals(shouldReverseMembershipCreditReservation({ reservedCreditCents: 1000, stripeSideEffectStarted: false, creditCommitted: true }), false);
  assertEquals(shouldReverseMembershipCreditReservation({ reservedCreditCents: 0, stripeSideEffectStarted: false, creditCommitted: false }), false);
});
