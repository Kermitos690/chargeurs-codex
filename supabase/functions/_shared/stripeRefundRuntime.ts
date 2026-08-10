import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";

export type PaymentIntentRefundResult = {
  paymentIntentId: string;
  canceledAuthorization: boolean;
  refundedCents: number;
  providerIds: string[];
};

function countsAsRefunded(refund: Stripe.Refund): boolean {
  return refund.status !== "failed" && refund.status !== "canceled";
}

async function currentRefunds(
  stripe: Stripe,
  paymentIntentId: string,
): Promise<{ cents: number; ids: string[] }> {
  const refunds = await stripe.refunds.list({
    payment_intent: paymentIntentId,
    limit: 100,
  });
  const accepted: Stripe.Refund[] = refunds.data.filter(countsAsRefunded);
  return {
    cents: accepted.reduce((sum: number, refund: Stripe.Refund) => sum + Number(refund.amount ?? 0), 0),
    ids: accepted.map((refund: Stripe.Refund) => refund.id),
  };
}

/**
 * Cancels an uncaptured authorization or refunds the remaining captured amount.
 *
 * The returned total is derived from Stripe, not by incrementing a local value.
 * Replaying after a database failure therefore cannot double-count a refund.
 */
export async function refundPaymentIntentBalance(
  stripe: Stripe,
  paymentIntentId: string,
  idempotencyPrefix: string,
): Promise<PaymentIntentRefundResult> {
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId);

  if (intent.status === "requires_capture") {
    const canceled = await stripe.paymentIntents.cancel(
      intent.id,
      {},
      { idempotencyKey: `${idempotencyPrefix}:cancel` },
    );
    return {
      paymentIntentId: intent.id,
      canceledAuthorization: true,
      refundedCents: 0,
      providerIds: [canceled.id],
    };
  }

  const capturedCents = Number(intent.amount_received ?? 0);
  const before = await currentRefunds(stripe, intent.id);
  const remainingCents = Math.max(0, capturedCents - before.cents);
  let providerIds = before.ids;

  if (remainingCents > 0) {
    const refund = await stripe.refunds.create(
      { payment_intent: intent.id, amount: remainingCents },
      { idempotencyKey: `${idempotencyPrefix}:refund:${remainingCents}` },
    );
    providerIds = Array.from(new Set([...providerIds, refund.id]));
  }

  const after = await currentRefunds(stripe, intent.id);
  return {
    paymentIntentId: intent.id,
    canceledAuthorization: false,
    refundedCents: after.cents,
    providerIds: Array.from(new Set([...providerIds, ...after.ids])),
  };
}
