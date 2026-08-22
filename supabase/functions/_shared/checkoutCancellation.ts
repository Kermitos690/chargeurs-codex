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
