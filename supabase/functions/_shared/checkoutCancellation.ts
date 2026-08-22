// A Checkout-created PaymentIntent can exist before the customer has supplied
// a payment method. Its identifier alone is not evidence of an authorization.

export type CheckoutCancellationDecision =
  | "cancelable"
  | "already_canceled"
  | "payment_confirmed"
  | "reconciliation_required";

export function classifyCheckoutIntentForExplicitCancellation(status: unknown): CheckoutCancellationDecision {
  switch (String(status ?? "")) {
    // Stripe documents these as incomplete states. They can be canceled only
    // on an explicit customer cancellation after Stripe has been queried.
    case "requires_payment_method":
    case "requires_confirmation":
    case "requires_action":
      return "cancelable";
    case "canceled":
      return "already_canceled";
    // An authorization or a completed payment must never be released through
    // the kiosk cancel path.
    case "requires_capture":
    case "succeeded":
      return "payment_confirmed";
    // Async and unknown states remain fail-closed.
    case "processing":
    default:
      return "reconciliation_required";
  }
}

export type StagingAuthorizationReleaseInput = {
  requested: boolean;
  confirmedNoHardwareRelease: boolean;
  confirmedTestAuthorizationRelease: boolean;
  recoveryReason: unknown;
  intent: {
    status?: unknown;
    livemode?: unknown;
    amount?: unknown;
    amount_capturable?: unknown;
    amount_received?: unknown;
    metadata?: Record<string, unknown> | null;
  };
  expectedRentalSessionId: string;
  expectedStationId: string;
  expectedAmountCents: number;
};

// This is deliberately not part of the customer cancellation path. It exists
// solely for a supervised STAGING recovery of a test card hold where Stripe
// proves that no amount was captured and the caller has separately proved that
// the kiosk has made no hardware release attempt.
export function stagingAuthorizationReleaseAllowed(input: StagingAuthorizationReleaseInput): boolean {
  const metadata = input.intent.metadata ?? {};
  return input.requested
    && input.confirmedNoHardwareRelease
    && input.confirmedTestAuthorizationRelease
    && input.recoveryReason === "operator_confirmed_no_hardware_release"
    && input.intent.livemode === false
    && input.intent.status === "requires_capture"
    && Number(input.intent.amount) === input.expectedAmountCents
    && Number(input.intent.amount_capturable) === input.expectedAmountCents
    && Number(input.intent.amount_received) === 0
    && String(metadata.rental_session_id ?? "") === input.expectedRentalSessionId
    && String(metadata.station_id ?? "") === input.expectedStationId;
}
