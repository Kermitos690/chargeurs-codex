export function stripeAmountAfterMembershipCredit(finalAmountCents: number, reservedCreditCents: number) {
  if (!Number.isInteger(finalAmountCents) || finalAmountCents < 0) {
    throw new Error("MEMBERSHIP_CREDIT_FINAL_AMOUNT_INVALID");
  }
  if (!Number.isInteger(reservedCreditCents) || reservedCreditCents < 0 || reservedCreditCents > finalAmountCents) {
    throw new Error("MEMBERSHIP_CREDIT_RESERVATION_INVALID");
  }
  return finalAmountCents - reservedCreditCents;
}

/**
 * The reservation is made when the rental payment becomes authoritative, not
 * when the customer merely starts a kiosk session.  It is deliberately capped
 * by the immutable tariff snapshot so a member cannot reserve an unbounded
 * amount while a battery is out.
 */
export function membershipCreditReservationCap(snapshot: Record<string, unknown>, fallbackCents: number) {
  const candidates = [snapshot.max_amount_cents, snapshot.total_cap_cents, fallbackCents]
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 0);
  const cap = candidates.find((value) => value > 0);
  if (!Number.isInteger(cap) || cap <= 0) throw new Error("MEMBERSHIP_CREDIT_RESERVATION_CAP_INVALID");
  return cap;
}

export function settleMembershipCreditReservation(finalAmountCents: number, reservedCreditCents: number) {
  const stripeDueCents = stripeAmountAfterMembershipCredit(finalAmountCents, Math.min(finalAmountCents, reservedCreditCents));
  return {
    committedCreditCents: Math.min(finalAmountCents, reservedCreditCents),
    releasedCreditCents: Math.max(0, reservedCreditCents - finalAmountCents),
    stripeDueCents,
  };
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
