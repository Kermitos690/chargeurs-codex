import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { planSettlement, resolveSettlementStrategy } from "../_shared/settlement.ts";

Deno.test("card with manual capture uses authorization settlement", () => {
  assertEquals(resolveSettlementStrategy({ paymentMethodType: "card", captureMethod: "manual" }), "manual_capture");
});

Deno.test("TWINT uses prepaid refund settlement", () => {
  assertEquals(resolveSettlementStrategy({ paymentMethodType: "twint", captureMethod: "automatic" }), "prepaid_refund");
});

Deno.test("manual capture captures only the final amount and releases the rest", () => {
  const plan = planSettlement({
    strategy: "manual_capture",
    finalAmountCents: 450,
    depositAmountCents: 3000,
    amountCapturableCents: 3000,
  });
  assertEquals(plan.captureCents, 450);
  assertEquals(plan.supplementalCents, 0);
  assertEquals(plan.cancelAuthorization, false);
  assertEquals(plan.actions, ["capture"]);
});

Deno.test("manual capture cancels a zero-value rental authorization", () => {
  const plan = planSettlement({
    strategy: "manual_capture",
    finalAmountCents: 0,
    depositAmountCents: 3000,
    amountCapturableCents: 3000,
  });
  assertEquals(plan.captureCents, 0);
  assertEquals(plan.cancelAuthorization, true);
  assertEquals(plan.actions, ["cancel_authorization"]);
});

Deno.test("manual capture identifies the 69 CHF non-return supplement", () => {
  const plan = planSettlement({
    strategy: "manual_capture",
    finalAmountCents: 9900,
    depositAmountCents: 3000,
    amountCapturableCents: 3000,
  });
  assertEquals(plan.captureCents, 3000);
  assertEquals(plan.supplementalCents, 6900);
  assertEquals(plan.actions, ["capture", "collect_supplemental"]);
});

Deno.test("TWINT prepays 30 CHF and refunds the unused balance", () => {
  const plan = planSettlement({
    strategy: "prepaid_refund",
    finalAmountCents: 450,
    depositAmountCents: 3000,
    amountCapturedCents: 3000,
  });
  assertEquals(plan.refundCents, 2550);
  assertEquals(plan.supplementalCents, 0);
  assertEquals(plan.actions, ["refund"]);
});

Deno.test("TWINT non-return identifies the 69 CHF supplement", () => {
  const plan = planSettlement({
    strategy: "prepaid_refund",
    finalAmountCents: 9900,
    depositAmountCents: 3000,
    amountCapturedCents: 3000,
  });
  assertEquals(plan.refundCents, 0);
  assertEquals(plan.supplementalCents, 6900);
  assertEquals(plan.actions, ["collect_supplemental"]);
});

Deno.test("previous refunds reduce the refundable balance", () => {
  const plan = planSettlement({
    strategy: "prepaid_refund",
    finalAmountCents: 1000,
    depositAmountCents: 3000,
    amountCapturedCents: 3000,
    amountAlreadyRefundedCents: 1500,
  });
  assertEquals(plan.refundCents, 1500);
});

Deno.test("negative amounts fail closed", () => {
  assertThrows(() => planSettlement({
    strategy: "manual_capture",
    finalAmountCents: -1,
    depositAmountCents: 3000,
  }), Error, "INVALID_FINAL_AMOUNT_CENTS");
});
