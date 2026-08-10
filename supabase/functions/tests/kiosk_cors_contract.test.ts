import { assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("rental-session browser preflight permits the kiosk credential and idempotency headers", async () => {
  const source = await Deno.readTextFile("supabase/functions/create-rental-session/index.ts");
  assertMatch(source, /Access-Control-Allow-Headers[^\n]*x-kiosk-token[^\n]*x-idempotency-key/);
  assertMatch(source, /OPTIONS[\s\S]{0,160}rentalCorsHeaders/);
});

Deno.test("kiosk creates direct hosted Stripe Checkout with Swiss hybrid settlement", async () => {
  const launcher = await Deno.readTextFile("supabase/functions/create-stripe-checkout/index.ts");

  assertMatch(launcher, /new Stripe\s*\(/);
  assertMatch(launcher, /stripe\.checkout\.sessions\.create/);
  assertMatch(launcher, /checkout_url:\s*checkout\.url/);
  assertMatch(launcher, /locale:\s*lang/);
  assertMatch(launcher, /X-Kiosk-Token/);
  assertMatch(launcher, /KIOSK_DEVICE_MISMATCH/);

  // Clover added per-payment-method capture control for Checkout. Cards and
  // card wallets are authorized for later capture while TWINT remains a native
  // automatically captured/refundable payment method.
  assertMatch(launcher, /2025-09-30\.clover/);
  assertMatch(launcher, /payment_method_types:\s*\["card",\s*"twint"\]/);
  assertMatch(launcher, /card:\s*\{\s*capture_method:\s*"manual"/);
  assertMatch(launcher, /setup_future_usage:\s*"off_session"/);
  if (/request_extended_authorization\s*:/.test(launcher)) {
    throw new Error("Extended authorization is not enabled on this Stripe account");
  }

  assertMatch(launcher, /STRIPE_TEST_KEY_REQUIRED/);
  assertMatch(launcher, /pricing_snapshot/);
  assertMatch(launcher, /pricing_snapshot_hash/);
  assertMatch(launcher, /SNAPSHOT_INVALID/);

  // /success and /cancel exist in both the currently served legacy frontend and
  // the merged replacement build, so Stripe can never redirect to a missing
  // /progress route while Vercel is serving the older bundle.
  assertMatch(launcher, /\/pay\/\$\{encodeURIComponent\(String\(session\.id\)\)\}\/success/);
  assertMatch(launcher, /\/pay\/\$\{encodeURIComponent\(String\(session\.id\)\)\}\/cancel/);
});
