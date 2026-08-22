import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(new URL("../public-stripe-checkout/index.ts", import.meta.url));

Deno.test("Stripe Checkout returns the customer to the canonical mobile rental tracker", () => {
  assert(source.includes('const APP_URL=(Deno.env.get("PUBLIC_APP_URL")'));
  assert(source.includes('`${APP_URL}/pay/${encodeURIComponent(id)}/${page}?c=${encodeURIComponent(code)}&lang=${encodeURIComponent(lang)}`'));
  assert(source.includes("success_url:progressUrl"));
  assert(source.includes('cancel_url:portal(String(s.id),code,lang,"choose")'));
  assertEquals(source.includes("/functions/v1/payment-portal?rental="), false);
});
