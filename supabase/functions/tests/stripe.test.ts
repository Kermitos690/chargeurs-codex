// STRIPE tests — real signature verification (same stripe lib & API as the
// webhook) plus the production payment-integrity and refund decision logic.
// A TEMPORARY webhook secret is generated in-process; no real Stripe calls.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import { signStripe } from "./_fakes.ts";
import { evaluatePaymentMatch, evaluateRefund } from "../_shared/payments.ts";
import { snapshotHash } from "../_shared/db.ts";
import { validateStripeTestRuntime } from "../_shared/stripeRuntimeConfig.ts";

const WHSEC = "whsec_test_" + crypto.randomUUID();
const stripe = new Stripe("sk_test_dummy", {
  apiVersion: "2024-12-18.acacia",
  httpClient: Stripe.createFetchHttpClient(),
});

Deno.test("runtime: accepts explicit test-only configuration", () => {
  const result = validateStripeTestRuntime({
    mode: "test",
    liveEnabled: "false",
    secretKey: "sk_test_example",
    webhookSecret: "whsec_example",
    requireWebhookSecret: true,
  });
  assertEquals(result.ok, true);
});

Deno.test("runtime: rejects a live key even when mode says test", () => {
  const result = validateStripeTestRuntime({
    mode: "test",
    liveEnabled: "false",
    secretKey: "sk_live_forbidden",
  });
  assertEquals(result.ok, false);
  assertEquals(result.error, "STRIPE_TEST_KEY_REQUIRED");
});

Deno.test("runtime: rejects missing explicit live-disable flag", () => {
  const result = validateStripeTestRuntime({
    mode: "test",
    liveEnabled: "",
    secretKey: "sk_test_example",
  });
  assertEquals(result.ok, false);
  assertEquals(result.error, "STRIPE_LIVE_DISABLED_REQUIRED");
});

Deno.test("runtime: webhook requires a signing secret", () => {
  const result = validateStripeTestRuntime({
    mode: "test",
    liveEnabled: "false",
    secretKey: "sk_test_example",
    webhookSecret: "",
    requireWebhookSecret: true,
  });
  assertEquals(result.ok, false);
  assertEquals(result.error, "STRIPE_WEBHOOK_SECRET_REQUIRED");
});

function evt() {
  return JSON.stringify({
    id: "evt_1",
    type: "checkout.session.completed",
    data: { object: { id: "cs_1" } },
  });
}

Deno.test("webhook signature: valid signature accepted", async () => {
  const payload = evt();
  const header = await signStripe(payload, WHSEC);
  const e = await stripe.webhooks.constructEventAsync(payload, header, WHSEC);
  assertEquals(e.id, "evt_1");
});

Deno.test("webhook signature: missing signature rejected", async () => {
  let threw = false;
  try {
    await stripe.webhooks.constructEventAsync(evt(), "", WHSEC);
  } catch {
    threw = true;
  }
  assert(threw);
});

Deno.test("webhook signature: wrong secret rejected", async () => {
  const payload = evt();
  const header = await signStripe(payload, "whsec_other");
  let threw = false;
  try {
    await stripe.webhooks.constructEventAsync(payload, header, WHSEC);
  } catch {
    threw = true;
  }
  assert(threw);
});

Deno.test("webhook signature: payload tampered after signing rejected", async () => {
  const payload = evt();
  const header = await signStripe(payload, WHSEC);
  let threw = false;
  try {
    await stripe.webhooks.constructEventAsync(payload + " ", header, WHSEC);
  } catch {
    threw = true;
  }
  assert(threw);
});

Deno.test("payment match: exact amount + currency + snapshot => ok", () => {
  const r = evaluatePaymentMatch({
    expectedCents: 500,
    paidCents: 500,
    expectedCurrency: "CHF",
    paidCurrency: "chf",
    hasSnapshot: true,
    storedHash: "h",
    recomputedHash: "h",
    metaHash: "h",
  });
  assertEquals(r.ok, true);
});

Deno.test("payment match: client-tampered amount => AMOUNT_MISMATCH, not ok", () => {
  const r = evaluatePaymentMatch({
    expectedCents: 500,
    paidCents: 100,
    expectedCurrency: "CHF",
    paidCurrency: "chf",
    hasSnapshot: false,
    storedHash: null,
    recomputedHash: null,
    metaHash: null,
  });
  assertEquals(r.ok, false);
  assertEquals(r.failureCode, "AMOUNT_MISMATCH");
});

Deno.test("payment match: wrong currency => not ok", () => {
  const r = evaluatePaymentMatch({
    expectedCents: 500,
    paidCents: 500,
    expectedCurrency: "CHF",
    paidCurrency: "eur",
    hasSnapshot: false,
    storedHash: null,
    recomputedHash: null,
    metaHash: null,
  });
  assertEquals(r.currencyOk, false);
  assertEquals(r.ok, false);
});

Deno.test("payment match: snapshot hash mismatch => SNAPSHOT_MISMATCH (priority)", () => {
  const r = evaluatePaymentMatch({
    expectedCents: 500,
    paidCents: 500,
    expectedCurrency: "CHF",
    paidCurrency: "chf",
    hasSnapshot: true,
    storedHash: "h",
    recomputedHash: "DIFFERENT",
    metaHash: "h",
  });
  assertEquals(r.snapshotOk, false);
  assertEquals(r.failureCode, "SNAPSHOT_MISMATCH");
});

Deno.test("payment match: metadata hash spoofed but recomputed==stored still checks meta", () => {
  const r = evaluatePaymentMatch({
    expectedCents: 500,
    paidCents: 500,
    expectedCurrency: "CHF",
    paidCurrency: "chf",
    hasSnapshot: true,
    storedHash: "h",
    recomputedHash: "h",
    metaHash: "SPOOF",
  });
  assertEquals(r.snapshotOk, false);
});

Deno.test("snapshot hash: key order independent, value sensitive", async () => {
  const a = await snapshotHash({ a: 1, b: { c: 2, d: 3 } });
  const b = await snapshotHash({ b: { d: 3, c: 2 }, a: 1 });
  const c = await snapshotHash({ a: 1, b: { c: 2, d: 4 } });
  assertEquals(a, b);
  assert(a !== c);
});

Deno.test("refund: full when requested<=0; integer cents", () => {
  const r = evaluateRefund({
    capturedCents: 500,
    requestedCents: 0,
    alreadyRefundedCents: 0,
  });
  assertEquals(r.ok, true);
  assertEquals(r.refundCents, 500);
});

Deno.test("refund: cannot exceed captured", () => {
  const r = evaluateRefund({
    capturedCents: 500,
    requestedCents: 600,
    alreadyRefundedCents: 0,
  });
  assertEquals(r.ok, false);
  assertEquals(r.error, "EXCEEDS_CAPTURED");
});

Deno.test("refund: already fully refunded => no-op", () => {
  const r = evaluateRefund({
    capturedCents: 500,
    requestedCents: 0,
    alreadyRefundedCents: 500,
  });
  assertEquals(r.ok, false);
  assertEquals(r.error, "ALREADY_REFUNDED");
});

Deno.test("refund: nothing captured", () => {
  const r = evaluateRefund({
    capturedCents: 0,
    requestedCents: 100,
    alreadyRefundedCents: 0,
  });
  assertEquals(r.error, "NOTHING_CAPTURED");
});

Deno.test("refund: partial within remaining", () => {
  const r = evaluateRefund({
    capturedCents: 500,
    requestedCents: 200,
    alreadyRefundedCents: 100,
  });
  assertEquals(r.ok, true);
  assertEquals(r.refundCents, 200);
});
