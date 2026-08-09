import { assertEquals } from "jsr:@std/assert@1.0.14";
import {
  CHECKOUT_VALIDITY_MINUTES,
  STRIPE_EXPIRY_SAFETY_BUFFER_SECONDS,
  checkoutExpiryUnix,
} from "../_shared/checkoutExpiry.ts";

Deno.test("Checkout expiration stays above Stripe's thirty-minute minimum", () => {
  const nowMs = 1_725_000_000_999;
  const nowSeconds = nowMs / 1000;
  const expiresAt = checkoutExpiryUnix(nowMs);

  assertEquals(
    expiresAt - Math.ceil(nowSeconds),
    (CHECKOUT_VALIDITY_MINUTES * 60) + STRIPE_EXPIRY_SAFETY_BUFFER_SECONDS,
  );
  // The crucial invariant: even when Stripe evaluates a few seconds later,
  // this cannot fall below its documented thirty-minute lower bound.
  assertEquals(expiresAt - Math.floor(nowSeconds) >= CHECKOUT_VALIDITY_MINUTES * 60, true);
});
