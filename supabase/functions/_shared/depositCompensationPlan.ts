export type DepositCompensationAction =
  | "cancel_authorization"
  | "refund_captured_balance"
  | "already_compensated"
  | "manual_review";

export interface DepositCompensationInput {
  paymentIntentStatus: string;
  amountReceivedCents: number;
  amountCapturableCents: number;
  amountAlreadyRefundedCents: number;
}

export interface DepositCompensationPlan {
  action: DepositCompensationAction;
  refundCents: number;
}

function cents(value: number, field: string): number {
  const normalized = Math.round(value);
  if (!Number.isFinite(normalized) || normalized < 0) throw new Error(`INVALID_${field.toUpperCase()}`);
  return normalized;
}

export function planFailedReleaseCompensation(input: DepositCompensationInput): DepositCompensationPlan {
  const received = cents(input.amountReceivedCents, "amount_received_cents");
  const capturable = cents(input.amountCapturableCents, "amount_capturable_cents");
  const refunded = cents(input.amountAlreadyRefundedCents, "amount_already_refunded_cents");
  const status = input.paymentIntentStatus;

  if (status === "requires_capture" && capturable > 0 && received === 0) {
    return { action: "cancel_authorization", refundCents: 0 };
  }

  const refundable = Math.max(0, received - refunded);
  if (refundable > 0) {
    return { action: "refund_captured_balance", refundCents: refundable };
  }

  if (status === "canceled" || (received > 0 && refunded >= received)) {
    return { action: "already_compensated", refundCents: 0 };
  }

  return { action: "manual_review", refundCents: 0 };
}
