import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { planFailedReleaseCompensation } from "../_shared/depositCompensationPlan.ts";

Deno.test("uncaptured card authorization is cancelled", () => {
  assertEquals(planFailedReleaseCompensation({
    paymentIntentStatus: "requires_capture",
    amountReceivedCents: 0,
    amountCapturableCents: 3000,
    amountAlreadyRefundedCents: 0,
  }), { action: "cancel_authorization", refundCents: 0 });
});

Deno.test("captured TWINT deposit is fully refunded", () => {
  assertEquals(planFailedReleaseCompensation({
    paymentIntentStatus: "succeeded",
    amountReceivedCents: 3000,
    amountCapturableCents: 0,
    amountAlreadyRefundedCents: 0,
  }), { action: "refund_captured_balance", refundCents: 3000 });
});

Deno.test("only the remaining captured balance is refunded", () => {
  assertEquals(planFailedReleaseCompensation({
    paymentIntentStatus: "succeeded",
    amountReceivedCents: 3000,
    amountCapturableCents: 0,
    amountAlreadyRefundedCents: 1000,
  }), { action: "refund_captured_balance", refundCents: 2000 });
});

Deno.test("an already cancelled authorization is idempotent", () => {
  assertEquals(planFailedReleaseCompensation({
    paymentIntentStatus: "canceled",
    amountReceivedCents: 0,
    amountCapturableCents: 0,
    amountAlreadyRefundedCents: 0,
  }), { action: "already_compensated", refundCents: 0 });
});

Deno.test("an ambiguous processing intent requires review", () => {
  assertEquals(planFailedReleaseCompensation({
    paymentIntentStatus: "processing",
    amountReceivedCents: 0,
    amountCapturableCents: 0,
    amountAlreadyRefundedCents: 0,
  }), { action: "manual_review", refundCents: 0 });
});

Deno.test("negative provider amounts fail closed", () => {
  assertThrows(() => planFailedReleaseCompensation({
    paymentIntentStatus: "succeeded",
    amountReceivedCents: -1,
    amountCapturableCents: 0,
    amountAlreadyRefundedCents: 0,
  }), Error, "INVALID_AMOUNT_RECEIVED_CENTS");
});
