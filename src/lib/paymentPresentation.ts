const SERVER_CONFIRMED_STATES = new Set([
  "ejected",
  "battery_taken",
  "active_rental",
  "battery_returned",
  "billing_pending",
  "completed",
  "closed",
]);

const SERVER_RELEASE_PENDING_STATES = new Set([
  "payment_succeeded",
  "ejecting",
]);

const SERVER_CANCELLED_STATES = new Set([
  "payment_cancelled",
  "payment_expired",
  "payment_failed",
]);

/**
 * Client redirects are presentation hints only. A payment is displayed as
 * confirmed exclusively after the scoped server status endpoint reports a
 * state that can only be reached by the verified Stripe webhook pipeline.
 */
export function isServerConfirmedPayment(state: string): boolean {
  return SERVER_CONFIRMED_STATES.has(state);
}

/** Payment is confirmed by Stripe, but the physical delivery is not yet. */
export function isServerReleasePending(state: string): boolean {
  return SERVER_RELEASE_PENDING_STATES.has(state);
}

export function isServerCancelledPayment(state: string): boolean {
  return SERVER_CANCELLED_STATES.has(state);
}
