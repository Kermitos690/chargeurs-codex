import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  membershipCreditReservationCap,
  settleMembershipCreditReservation,
  shouldReverseMembershipCreditReservation,
  stripeAmountAfterMembershipCredit,
} from "../_shared/membershipCreditReservation.ts";

Deno.test("membership credit lowers only the final rental amount", () => {
  assertEquals(stripeAmountAfterMembershipCredit(2990, 1000), 1990);
  assertEquals(stripeAmountAfterMembershipCredit(1000, 1000), 0);
  assertThrows(() => stripeAmountAfterMembershipCredit(1000, 1001), Error, "MEMBERSHIP_CREDIT_RESERVATION_INVALID");
});

Deno.test("reservation is limited by the immutable rental tariff and releases the unused amount", () => {
  assertEquals(membershipCreditReservationCap({ max_amount_cents: 2990 }, 3000), 2990);
  assertThrows(() => membershipCreditReservationCap({}, 0), Error, "MEMBERSHIP_CREDIT_RESERVATION_CAP_INVALID");
  assertEquals(settleMembershipCreditReservation(390, 1000), {
    committedCreditCents: 390,
    releasedCreditCents: 610,
    stripeDueCents: 0,
  });
  assertEquals(settleMembershipCreditReservation(2990, 1000), {
    committedCreditCents: 1000,
    releasedCreditCents: 0,
    stripeDueCents: 1990,
  });
});

Deno.test("only a reservation before any Stripe side effect is automatically reversed", () => {
  assertEquals(shouldReverseMembershipCreditReservation({ reservedCreditCents: 1000, stripeSideEffectStarted: false, creditCommitted: false }), true);
  assertEquals(shouldReverseMembershipCreditReservation({ reservedCreditCents: 1000, stripeSideEffectStarted: true, creditCommitted: false }), false);
  assertEquals(shouldReverseMembershipCreditReservation({ reservedCreditCents: 1000, stripeSideEffectStarted: false, creditCommitted: true }), false);
  assertEquals(shouldReverseMembershipCreditReservation({ reservedCreditCents: 0, stripeSideEffectStarted: false, creditCommitted: false }), false);
});
