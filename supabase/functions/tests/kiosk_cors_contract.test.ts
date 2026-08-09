import { assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("rental-session browser preflight permits the kiosk credential and idempotency headers", async () => {
  const source = await Deno.readTextFile("supabase/functions/create-rental-session/index.ts");
  assertMatch(source, /Access-Control-Allow-Headers[^\n]*x-kiosk-token[^\n]*x-idempotency-key/);
  assertMatch(source, /OPTIONS[\s\S]{0,160}rentalCorsHeaders/);
});

Deno.test("Checkout remains hosted QR payment with Stripe-managed dynamic methods and a locale", async () => {
  const source = await Deno.readTextFile("supabase/functions/create-stripe-checkout/index.ts");
  assertMatch(source, /locale,/);
  assertMatch(source, /checkoutLocale\(session\.customer_language/);
  assertMatch(source, /Dashboard configuration/);
  if (/payment_method_types\s*:/.test(source)) {
    throw new Error("Hosted Checkout must not be restricted to a fixed payment_method_types list");
  }
});
