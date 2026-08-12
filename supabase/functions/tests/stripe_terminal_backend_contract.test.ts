import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  canonicalTerminalAmountCents,
  canonicalTerminalCurrency,
  requireStripeTestKey,
  terminalBindingUsable,
  terminalIntentIdempotencyKey,
} from "../_shared/stripeTerminalTest.ts";

const backendSource = await Deno.readTextFile(
  new URL("../stripe-terminal-backend/index.ts", import.meta.url),
);

Deno.test("Terminal amount remains server-owned from rental canonical deposit", () => {
  assertEquals(canonicalTerminalAmountCents({
    deposit_amount_cents: 3000,
    pricing_snapshot: { deposit_cents: 9999 },
  }), 3000);
  assertEquals(canonicalTerminalAmountCents({
    pricing_snapshot: { deposit_cents: 3000 },
  }), 3000);
  assertEquals(canonicalTerminalAmountCents({ deposit_amount_cents: 0 }), null);
});

Deno.test("Terminal first milestone is TEST-only and CHF-only", () => {
  assert(requireStripeTestKey("sk_test_example"));
  assert(requireStripeTestKey("rk_test_example"));
  assertEquals(requireStripeTestKey("sk_live_example"), false);
  assertEquals(canonicalTerminalCurrency({ currency: "CHF" }), "chf");
  assertEquals(canonicalTerminalCurrency({ currency: "EUR" }), null);
});

Deno.test("station binding must be enabled TEST with a server-owned Stripe Location", () => {
  assert(terminalBindingUsable({ enabled: true, environment: "test", stripe_location_id: "tml_test_123" }));
  assertEquals(terminalBindingUsable({ enabled: false, environment: "test", stripe_location_id: "tml_test_123" }), false);
  assertEquals(terminalBindingUsable({ enabled: true, environment: "live", stripe_location_id: "tml_live_123" }), false);
  assertEquals(terminalBindingUsable({ enabled: true, environment: "test", stripe_location_id: "" }), false);
});

Deno.test("PaymentIntent idempotency is stable per rental amount and pricing hash", () => {
  const first = terminalIntentIdempotencyKey("rental-1", 3000, "pricing-hash");
  const retry = terminalIntentIdempotencyKey("rental-1", 3000, "pricing-hash");
  const changed = terminalIntentIdempotencyKey("rental-1", 3100, "pricing-hash");
  assertEquals(first, retry);
  assert(first !== changed);
});

Deno.test("ConnectionToken is scoped to server binding and never accepts client location authority", () => {
  assert(backendSource.includes('stripe.terminal.connectionTokens.create({ location: String(binding.stripe_location_id) })'));
  assertEquals(backendSource.includes("body.locationId"), false);
  assertEquals(backendSource.includes("body.readerId"), false);
});

Deno.test("Terminal PaymentIntent is card_present manual capture and TEST guarded", () => {
  assert(backendSource.includes('payment_method_types: ["card_present"]'));
  assert(backendSource.includes('capture_method: "manual"'));
  assert(backendSource.includes("STRIPE_TEST_KEY_REQUIRED"));
  assert(backendSource.includes("canonicalTerminalAmountCents(session)"));
});

Deno.test("rental PaymentIntent reader and Location correlation is persisted", () => {
  assert(backendSource.includes('db.from("stripe_terminal_payment_attempts")'));
  assert(backendSource.includes("stripe_payment_intent_id: intent.id"));
  assert(backendSource.includes("stripe_location_id: binding.stripe_location_id"));
  assert(backendSource.includes("stripe_reader_id: binding.stripe_reader_id ?? null"));
  assert(backendSource.includes("rental_session_id: rentalSessionId"));
});

Deno.test("Terminal claims its rail before PaymentIntent creation and QR remains separate", () => {
  const claim = backendSource.indexOf('p_rail: "stripe_terminal"');
  const createIntent = backendSource.indexOf("stripe.paymentIntents.create");
  assert(claim >= 0);
  assert(createIntent > claim);
  assertEquals(backendSource.includes("checkout.sessions.create"), false);
});

Deno.test("Terminal backend contains no ejection return or settlement mutation", () => {
  assertEquals(backendSource.includes("ejectByRent"), false);
  assertEquals(backendSource.includes("eject-after-payment"), false);
  assertEquals(backendSource.includes("BATTERY_IN"), false);
  assertEquals(backendSource.includes("settle-rental-payment"), false);
  assertEquals(backendSource.includes("compute_pricing"), false);
});
