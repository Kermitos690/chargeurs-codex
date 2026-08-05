// Stripe Checkout requires expires_at to be at least thirty minutes after the
// request reaches Stripe. Do not use Math.floor(now / 1000) + 1800: after
// network latency that can be 29m59s away and Stripe rejects the session.
export const CHECKOUT_VALIDITY_MINUTES = 30;
export const STRIPE_EXPIRY_SAFETY_BUFFER_SECONDS = 60;

export function checkoutExpiryUnix(nowMs = Date.now()): number {
  return Math.ceil(nowMs / 1000) + (CHECKOUT_VALIDITY_MINUTES * 60) + STRIPE_EXPIRY_SAFETY_BUFFER_SECONDS;
}
