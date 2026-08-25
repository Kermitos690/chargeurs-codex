import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  canonicalRail,
  canonicalTerminalAmountCents,
  canonicalTerminalCurrency,
  requireStripeTestKey,
  stripeIntentHasFinancialSideEffect,
  stripeIntentSafelyCancelable,
  terminalBindingUsable,
  terminalIntentIdempotencyKey,
  terminalRailState,
} from "../_shared/stripeTerminalTest.ts";
import { classifyCheckoutIntentForExplicitCancellation } from "../_shared/checkoutCancellation.ts";
import { receiptEmailForPaymentIntent } from "../_shared/stripeReceipt.ts";

const backendSource = await Deno.readTextFile(new URL("../stripe-terminal-backend/index.ts", import.meta.url));
const qrSource = await Deno.readTextFile(new URL("../create-stripe-checkout/index.ts", import.meta.url));
const webhookSource = await Deno.readTextFile(new URL("../stripe-webhook/index.ts", import.meta.url));
const webhookGatewaySource = await Deno.readTextFile(new URL("../stripe-webhook-gateway/index.ts", import.meta.url));
const terminalCancellationMigration = await Deno.readTextFile(
  new URL("../../migrations/20260825112843_finalize_confirmed_terminal_cancellation.sql", import.meta.url),
);

Deno.test("Terminal amount remains server-owned from rental canonical deposit", () => {
  assertEquals(canonicalTerminalAmountCents({ deposit_amount_cents: 3000, pricing_snapshot: { deposit_cents: 9999 } }), 3000);
  assertEquals(canonicalTerminalAmountCents({ pricing_snapshot: { deposit_cents: 3000 } }), 3000);
  assertEquals(canonicalTerminalAmountCents({ deposit_amount_cents: 0 }), null);
});

Deno.test("Terminal is TEST-only and CHF-only", () => {
  assert(requireStripeTestKey("sk_test_example"));
  assert(requireStripeTestKey("rk_test_example"));
  assertEquals(requireStripeTestKey("sk_live_example"), false);
  assertEquals(canonicalTerminalCurrency({ currency: "CHF" }), "chf");
  assertEquals(canonicalTerminalCurrency({ currency: "EUR" }), null);
});

Deno.test("station binding must be enabled TEST with server-owned Stripe Location", () => {
  assert(terminalBindingUsable({ enabled: true, environment: "test", stripe_location_id: "tml_test_123" }));
  assertEquals(terminalBindingUsable({ enabled: false, environment: "test", stripe_location_id: "tml_test_123" }), false);
  assertEquals(terminalBindingUsable({ enabled: true, environment: "live", stripe_location_id: "tml_live_123" }), false);
});

Deno.test("idempotency is stable inside a generation and changes for an explicit retry generation", () => {
  const first = terminalIntentIdempotencyKey("rental-1", 3000, "pricing-hash", 1);
  assertEquals(first, terminalIntentIdempotencyKey("rental-1", 3000, "pricing-hash", 1));
  assert(first !== terminalIntentIdempotencyKey("rental-1", 3000, "pricing-hash", 2));
});

Deno.test("canonical backend rail projection is NONE TERMINAL QR only", () => {
  assertEquals(canonicalRail(null), "NONE");
  assertEquals(canonicalRail("stripe_terminal", "engaged"), "TERMINAL");
  assertEquals(canonicalRail("qr_checkout", "engaged"), "QR");
  assertEquals(canonicalRail("stripe_terminal", "released"), "NONE");
});

Deno.test("Terminal rail states distinguish success cancellation expiry and uncertain recovery", () => {
  assertEquals(terminalRailState("requires_payment_method", "engaged"), "ENGAGED");
  assertEquals(terminalRailState("processing", "engaged"), "PROCESSING");
  assertEquals(terminalRailState("requires_capture", "engaged"), "SUCCEEDED");
  assertEquals(terminalRailState("canceled", "released"), "UNCLAIMED");
  assertEquals(terminalRailState("timed_out", "engaged"), "EXPIRED");
  assertEquals(terminalRailState("creating", "reconciliation_required"), "RECOVERY_REQUIRED");
});

Deno.test("cancel safety refuses confirmed financial side effects and identifies cancelable setup states", () => {
  assert(stripeIntentSafelyCancelable("requires_payment_method"));
  assert(stripeIntentSafelyCancelable("processing"));
  assertEquals(stripeIntentHasFinancialSideEffect("requires_capture"), true);
  assertEquals(stripeIntentHasFinancialSideEffect("succeeded"), true);
});

Deno.test("Checkout cancellation only releases Stripe-incomplete intents", () => {
  assertEquals(classifyCheckoutIntentForExplicitCancellation("requires_payment_method"), "cancelable");
  assertEquals(classifyCheckoutIntentForExplicitCancellation("requires_confirmation"), "cancelable");
  assertEquals(classifyCheckoutIntentForExplicitCancellation("requires_action"), "cancelable");
  assertEquals(classifyCheckoutIntentForExplicitCancellation("canceled"), "already_canceled");
});

Deno.test("Checkout cancellation fails closed for processing, paid, and unknown intents", () => {
  assertEquals(classifyCheckoutIntentForExplicitCancellation("processing"), "reconciliation_required");
  assertEquals(classifyCheckoutIntentForExplicitCancellation("requires_capture"), "payment_confirmed");
  assertEquals(classifyCheckoutIntentForExplicitCancellation("succeeded"), "payment_confirmed");
  assertEquals(classifyCheckoutIntentForExplicitCancellation("unexpected"), "reconciliation_required");
});

Deno.test("ConnectionToken reader connectivity requires station not rental and creates no rental", () => {
  const tokenStart = backendSource.indexOf('if (action === "connection_token")');
  const tokenEnd = backendSource.indexOf('rentalSessionId = typeof body.rentalSessionId', tokenStart);
  assert(tokenStart >= 0);
  assert(tokenEnd > tokenStart);
  const tokenBranch = backendSource.slice(tokenStart, tokenEnd);
  assert(tokenBranch.includes("body.stationId"));
  assert(tokenBranch.includes("kioskAuth(req, db, stationId)"));
  assert(tokenBranch.includes('simulatedReader ? {} : { location: String(binding.stripe_location_id) }'));
  assertEquals(tokenBranch.includes("rental_sessions").valueOf(), false);
  assertEquals(tokenBranch.includes("insert({ rental").valueOf(), false);
});

Deno.test("Terminal PaymentIntent is card_present manual capture and server-priced", () => {
  assert(backendSource.includes('payment_method_types: ["card_present"]'));
  assert(backendSource.includes('capture_method: "manual"'));
  assert(backendSource.includes("canonicalTerminalAmountCents(session)"));
  assertEquals(backendSource.includes("body.amount"), false);
  assertEquals(backendSource.includes("body.locationId"), false);
  assertEquals(backendSource.includes("body.readerId"), false);
});

Deno.test("Terminal receipt email is sent only from a server-stored valid address", () => {
  assertEquals(receiptEmailForPaymentIntent("client@example.ch"), "client@example.ch");
  assertEquals(receiptEmailForPaymentIntent(" not-an-email "), null);
  assertEquals(receiptEmailForPaymentIntent(null), null);
  assert(backendSource.includes("receipt_email: receiptEmail"));
});

Deno.test("restart reuses active PaymentIntent and explicit retry advances idempotency generation", () => {
  assert(backendSource.includes("current.attempt?.stripe_payment_intent_id"));
  assert(backendSource.includes("attempt_generation"));
  assert(backendSource.includes("previous_payment_intent_ids"));
  assert(backendSource.includes('action === "retry_payment_intent"'));
});

Deno.test("cancel timeout and uncertain failure never auto-fallback to QR", () => {
  assert(backendSource.includes('"cancel_payment_intent"'));
  assert(backendSource.includes('"timeout_payment_intent"'));
  assert(backendSource.includes("PAYMENT_RECONCILIATION_REQUIRED"));
  assert(backendSource.includes("mark_rental_payment_rail_reconciliation_required"));
  assertEquals(backendSource.includes("create-stripe-checkout"), false);
  assertEquals(backendSource.includes("checkout.sessions.create"), false);
});

Deno.test("Stripe-confirmed Terminal cancellation atomically clears only pre-ejection state", () => {
  assert(backendSource.includes("finalizeConfirmedTerminalCancellation"));
  assert(backendSource.includes('finalize_confirmed_terminal_cancellation'));
  assert(terminalCancellationMigration.includes("TERMINAL_CANCELLATION_AFTER_HARDWARE_COMMAND"));
  assert(terminalCancellationMigration.includes("TERMINAL_CANCELLATION_FINANCIAL_SIDE_EFFECT"));
  assert(terminalCancellationMigration.includes("state = 'payment_cancelled'"));
  assert(terminalCancellationMigration.includes("old.state = 'needs_support' and new.state = 'payment_cancelled'"));
  assert(terminalCancellationMigration.includes("a.status = 'canceled'"));
  assert(terminalCancellationMigration.includes("UNVERIFIED_SINGLE_RELEASE_RECOVERY"));
  assert(terminalCancellationMigration.includes("UNVERIFIED_RETURNED_VOIDED_TEST_CYCLE"));
});

Deno.test("QR claims rail before creating a Checkout side effect", () => {
  const claim = qrSource.indexOf('p_rail: "qr_checkout"');
  const stripeClient = qrSource.indexOf("const stripe = new Stripe", claim);
  const create = qrSource.indexOf("stripe.checkout.sessions.create", claim);
  assert(claim >= 0);
  assert(stripeClient > claim);
  assert(create > claim);
});

Deno.test("Terminal claims before PaymentIntent creation so simultaneous QR loses at DB authority", () => {
  const claim = backendSource.indexOf('p_rail: "stripe_terminal"');
  const createIntent = backendSource.indexOf("stripe.paymentIntents.create", claim);
  assert(claim >= 0);
  assert(createIntent > claim);
});

Deno.test("server reconciliation is explicit and native callback alone cannot confirm payment", () => {
  assert(backendSource.includes('"reconcile_payment_intent"'));
  assert(backendSource.includes("stripe.paymentIntents.retrieve"));
  assert(backendSource.includes("serverConfirmed: Boolean(session.paid_at)"));
  assertEquals(backendSource.includes("nativePaymentSucceeded"), false);
});

Deno.test("existing signed Stripe webhook already authoritatively handles Terminal PI authorization/failure by rental metadata", () => {
  assert(webhookSource.includes('case "payment_intent.amount_capturable_updated"'));
  assert(webhookSource.includes('case "payment_intent.payment_failed"'));
  assert(webhookSource.includes("intent.metadata?.rental_session_id"));
  assert(webhookSource.includes("processPaymentIntent(db, stripe, session, intent, event)"));
});

Deno.test("simulated Terminal reader is server-gated and never reaches physical ejection", () => {
  assert(backendSource.includes('Deno.env.get("STRIPE_TERMINAL_SIMULATED_READER_ENABLED") === "true"'));
  assert(backendSource.includes('body.simulatedReader === true'));
  assert(backendSource.includes('chargeurs_terminal_simulated_reader: simulatedReader ? "true" : "false"'));
  const simulatedGuard = webhookSource.indexOf("isSimulatedTerminalIntent(intent)");
  const physicalTrigger = webhookSource.indexOf("await triggerEjection(String(session.id))");
  assert(simulatedGuard >= 0);
  assert(physicalTrigger > simulatedGuard);
  assert(webhookSource.includes("SIMULATED_TERMINAL_PAYMENT_VOIDED_NO_HARDWARE"));
  assert(webhookGatewaySource.includes("SIMULATED_TERMINAL_NO_EJECTION"));
});

Deno.test("simulated Terminal reconciliation voids only its own capturable TEST authorization", () => {
  assert(backendSource.includes('release_reason,correlation_id,metadata'));
  assert(backendSource.includes('claim?.metadata?.reader_mode === "simulated"'));
  assert(backendSource.includes("intent.livemode === false"));
  assert(backendSource.includes('if (isSimulatedTerminalIntent && intent.status === "requires_capture")'));
  assert(backendSource.includes('isSimulatedTerminalIntent\n          ? "simulated_terminal_authorization_voided_no_hardware"'));
  assert(backendSource.includes('"simulated_terminal_authorization_voided_no_hardware"'));
  assert(backendSource.includes('simulatedAuthorizationVoided\n    ? "CANCELLED"'));
});

Deno.test("Terminal backend contains no direct ejection return or settlement implementation", () => {
  assertEquals(backendSource.includes("ejectByRent"), false);
  assertEquals(backendSource.includes("eject-after-payment"), false);
  assertEquals(backendSource.includes("BATTERY_IN"), false);
  assertEquals(backendSource.includes("settle-rental-payment"), false);
  assertEquals(backendSource.includes("compute_pricing"), false);
});
