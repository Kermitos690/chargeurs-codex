import { assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("rental-session browser preflight permits the kiosk credential and idempotency headers", async () => {
  const source = await Deno.readTextFile("supabase/functions/create-rental-session/index.ts");
  assertMatch(source, /Access-Control-Allow-Headers[^\n]*x-kiosk-token[^\n]*x-idempotency-key/);
  assertMatch(source, /OPTIONS[\s\S]{0,160}rentalCorsHeaders/);
});

Deno.test("kiosk creates the real hosted Stripe Checkout and preserves the customer locale", async () => {
  const launcher = await Deno.readTextFile("supabase/functions/create-stripe-checkout/index.ts");

  // The authenticated kiosk creates one real Stripe Checkout Session and puts
  // checkout.url directly into the QR. There is no Supabase/Vercel payment
  // portal between the customer and Stripe.
  assertMatch(launcher, /new Stripe\s*\(/);
  assertMatch(launcher, /stripe\.checkout\.sessions\.create/);
  assertMatch(launcher, /checkout_url:\s*checkout\.url/);
  assertMatch(launcher, /locale:\s*lang/);
  assertMatch(launcher, /X-Kiosk-Token/);
  assertMatch(launcher, /KIOSK_DEVICE_MISMATCH/);

  // Card-capable wallets use a bank authorisation/manual capture. Other
  // Dashboard-enabled methods (including eligible TWINT) remain dynamic and
  // therefore retain their normal automatic-capture semantics.
  assertMatch(launcher, /capture_method:\s*"manual"/);
  assertMatch(launcher, /setup_future_usage:\s*"off_session"/);
  if (/request_extended_authorization\s*:/.test(launcher)) {
    throw new Error("This Stripe account is not eligible for extended authorization; the kiosk Checkout must not request it");
  }
  if (/payment_method_types\s*:/.test(launcher)) {
    throw new Error("Direct kiosk Checkout must keep Stripe Dashboard dynamic payment methods enabled");
  }

  // Safety: staging can never silently use a live secret and financial amounts
  // must come from the frozen server-side pricing snapshot.
  assertMatch(launcher, /STRIPE_TEST_KEY_REQUIRED/);
  assertMatch(launcher, /pricing_snapshot/);
  assertMatch(launcher, /pricing_snapshot_hash/);
  assertMatch(launcher, /SNAPSHOT_INVALID/);

  // Stripe redirects back to Chargeurs only after the hosted payment step.
  assertMatch(launcher, /\/pay\/\$\{encodeURIComponent\(String\(session\.id\)\)\}\/progress/);
  assertMatch(launcher, /\/pay\/\$\{encodeURIComponent\(String\(session\.id\)\)\}\/cancel/);
});
