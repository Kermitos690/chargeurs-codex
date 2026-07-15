// Pure Chargeurs.ch payment lifecycle rules. No Stripe or database I/O.
// Monetary values are integer cents.

export const DEFAULT_AUTHORIZATION_CENTS = 3000;
export const DEFAULT_NON_RETURN_TOTAL_CENTS = 9900;

export type SettlementReason = "returned" | "non_return" | "cancelled" | "release_failed";

export type SettlementInput = {
  reason: SettlementReason;
  authorizedCents: number;
  calculatedRentalCents: number;
  capturedCents?: number;
  refundedCents?: number;
  nonReturnTotalCents?: number;
};

export type SettlementPlan = {
  valid: boolean;
  error: "INVALID_AMOUNT" | "CAPTURE_EXCEEDS_AUTHORIZATION" | null;
  finalTotalCents: number;
  captureFromAuthorizationCents: number;
  cancelAuthorization: boolean;
  additionalChargeCents: number;
  refundCents: number;
  terminalState: "completed" | "refunded" | "cancelled" | "needs_support";
};

function cents(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : -1;
}

export function planSettlement(input: SettlementInput): SettlementPlan {
  const authorized = cents(input.authorizedCents);
  const rental = cents(input.calculatedRentalCents);
  const captured = cents(input.capturedCents ?? 0);
  const refunded = cents(input.refundedCents ?? 0);
  const nonReturn = cents(input.nonReturnTotalCents ?? DEFAULT_NON_RETURN_TOTAL_CENTS);

  if ([authorized, rental, captured, refunded, nonReturn].some((value) => value < 0)) {
    return {
      valid: false,
      error: "INVALID_AMOUNT",
      finalTotalCents: 0,
      captureFromAuthorizationCents: 0,
      cancelAuthorization: false,
      additionalChargeCents: 0,
      refundCents: 0,
      terminalState: "needs_support",
    };
  }

  if (captured > authorized && input.reason !== "non_return") {
    return {
      valid: false,
      error: "CAPTURE_EXCEEDS_AUTHORIZATION",
      finalTotalCents: 0,
      captureFromAuthorizationCents: 0,
      cancelAuthorization: false,
      additionalChargeCents: 0,
      refundCents: 0,
      terminalState: "needs_support",
    };
  }

  if (input.reason === "cancelled" || input.reason === "release_failed") {
    return {
      valid: true,
      error: null,
      finalTotalCents: 0,
      captureFromAuthorizationCents: 0,
      cancelAuthorization: captured === 0,
      additionalChargeCents: 0,
      refundCents: Math.max(0, captured - refunded),
      terminalState: captured > refunded ? "refunded" : "cancelled",
    };
  }

  const finalTotal = input.reason === "non_return" ? nonReturn : rental;
  const alreadyNetCaptured = Math.max(0, captured - refunded);
  const remainingDue = Math.max(0, finalTotal - alreadyNetCaptured);
  const remainingAuthorization = Math.max(0, authorized - captured);
  const captureFromAuthorization = Math.min(remainingDue, remainingAuthorization);
  const additional = Math.max(0, remainingDue - captureFromAuthorization);
  const overpaid = Math.max(0, alreadyNetCaptured - finalTotal);

  return {
    valid: true,
    error: null,
    finalTotalCents: finalTotal,
    captureFromAuthorizationCents: captureFromAuthorization,
    cancelAuthorization: captureFromAuthorization === 0 && captured === 0,
    additionalChargeCents: additional,
    refundCents: Math.max(0, overpaid - refunded),
    terminalState: additional > 0 ? "needs_support" : overpaid > refunded ? "refunded" : "completed",
  };
}

export function isAuthorizationAmountAllowed(amountCents: number, expected = DEFAULT_AUTHORIZATION_CENTS): boolean {
  return Number.isInteger(amountCents) && amountCents === expected;
}
