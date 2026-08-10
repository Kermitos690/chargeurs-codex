import { assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("rental-session browser preflight permits the kiosk credential and idempotency headers", async () => {
  const source = await Deno.readTextFile("supabase/functions/create-rental-session/index.ts");
  assertMatch(source, /Access-Control-Allow-Headers[^\n]*x-kiosk-token[^\n]*x-idempotency-key/);
  assertMatch(source, /OPTIONS[\s\S]{0,160}rentalCorsHeaders/);
});

Deno.test("kiosk launches a localized Chargeurs phone portal and Stripe is created only after the phone payment choice", async () => {
  const launcher = await Deno.readTextFile("supabase/functions/create-stripe-checkout/index.ts");
  const portal = await Deno.readTextFile("supabase/functions/payment-portal/index.ts");
  const stripe = await Deno.readTextFile("supabase/functions/public-stripe-checkout/index.ts");

  // The kiosk returns a Chargeurs-hosted phone URL; it does not instantiate
  // Stripe or collect payment credentials itself.
  assertMatch(launcher, /\/functions\/v1\/payment-portal/);
  assertMatch(launcher, /customer_language/);
  assertMatch(launcher, /&lang=\$\{lang\}/);
  if (/new Stripe\s*\(/.test(launcher)) {
    throw new Error("The kiosk payment launcher must not instantiate Stripe directly");
  }

  // The phone portal carries the locale into the server-side payment choice.
  assertMatch(portal, /langOf\(/);
  assertMatch(portal, /\/functions\/v1\/public-stripe-checkout/);
  assertMatch(portal, /language:lang/);

  // Stripe Checkout is hosted on the phone and preserves the customer locale.
  // Payment methods are intentionally mode-specific because the guarantee
  // mechanics differ: card uses manual capture, TWINT uses prepaid+refund.
  assertMatch(stripe, /locale:lang/);
  assertMatch(stripe, /payment_method_types:mode==="card_hold"\?\["card"\]:\["twint"\]/);
  assertMatch(stripe, /capture_method="manual"/);
  assertMatch(stripe, /setup_future_usage="off_session"/);
  assertMatch(stripe, /STRIPE_TEST_KEY_REQUIRED/);
});
