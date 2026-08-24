export function stripeAmountAfterMembershipCredit(finalAmountCents: number, reservedCreditCents: number) {
  if (!Number.isInteger(finalAmountCents) || finalAmountCents < 0) {
    throw new Error("MEMBERSHIP_CREDIT_FINAL_AMOUNT_INVALID");
  }
  if (!Number.isInteger(reservedCreditCents) || reservedCreditCents < 0 || reservedCreditCents > finalAmountCents) {
    throw new Error("MEMBERSHIP_CREDIT_RESERVATION_INVALID");
  }
  return finalAmountCents - reservedCreditCents;
}

// An API timeout after a call to Stripe is not proof that Stripe did nothing.
// Preserve the reservation in that case so a retry/reconciliation cannot spend
// the credit twice or silently give away an unpaid rental.
export function shouldReverseMembershipCreditReservation(input: {
  reservedCreditCents: number;
  stripeSideEffectStarted: boolean;
  creditCommitted: boolean;
}) {
  return input.reservedCreditCents > 0 && !input.stripeSideEffectStarted && !input.creditCommitted;
}
