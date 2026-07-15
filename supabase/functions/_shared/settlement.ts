// Pure settlement planning for Chargeurs.ch rentals.
//
// Cards can use manual capture: 30 CHF is authorized, then the final amount is
// captured when the rental ends. TWINT does not support manual capture, so the
// 30 CHF deposit is charged immediately and the unused balance is refunded.
// Any final amount above the deposit becomes a supplemental collection.

export type SettlementStrategy = "manual_capture" | "prepaid_refund";

export type SettlementAction =
  | "capture"
  | "cancel_authorization"
  | "refund"
  | "collect_supplemental"
  | "none";

export interface SettlementPlanInput {
  strategy: unknown;
  finalAmountCents: number;
  depositAmountCents: number;
  amountCapturableCents?: number;
  amountCapturedCents?: number;
  amountAlreadyRefundedCents?: number;
}

export interface SettlementPlan {
  strategy: SettlementStrategy;
  finalAmountCents: number;
  captureCents: number;
  cancelAuthorization: boolean;
  refundCents: number;
  supplementalCents: number;
  actions: SettlementAction[];
}

function cents(value: number | undefined, field: string): number {
  const normalized = Math.round(value ?? 0);
  if (!Number.isFinite(normalized) || normalized < 0) {
    throw new Error(`INVALID_${field.toUpperCase()}`);
  }
  return normalized;
}

export function parseSettlementStrategy(value: unknown): SettlementStrategy {
  if (value === "manual_capture" || value === "prepaid_refund") return value;
  throw new Error("INVALID_SETTLEMENT_STRATEGY");
}

export function resolveSettlementStrategy(args: {
  paymentMethodType?: string | null;
  captureMethod?: string | null;
}): SettlementStrategy {
  const method = (args.paymentMethodType ?? "").toLowerCase();
  const capture = (args.captureMethod ?? "").toLowerCase();
  return method === "card" && capture === "manual" ? "manual_capture" : "prepaid_refund";
}

export function planSettlement(input: SettlementPlanInput): SettlementPlan {
  const strategy = parseSettlementStrategy(input.strategy);
  const finalAmountCents = cents(input.finalAmountCents, "final_amount_cents");
  const depositAmountCents = cents(input.depositAmountCents, "deposit_amount_cents");
  const amountAlreadyRefundedCents = cents(input.amountAlreadyRefundedCents, "already_refunded_cents");

  let captureCents = 0;
  let cancelAuthorization = false;
  let refundCents = 0;
  let supplementalCents = 0;

  if (strategy === "manual_capture") {
    const capturable = cents(input.amountCapturableCents ?? depositAmountCents, "capturable_cents");
    captureCents = Math.min(finalAmountCents, capturable);
    cancelAuthorization = captureCents === 0 && capturable > 0;
    supplementalCents = Math.max(0, finalAmountCents - captureCents);
  } else {
    const captured = cents(input.amountCapturedCents ?? depositAmountCents, "captured_cents");
    const refundableBalance = Math.max(0, captured - amountAlreadyRefundedCents);
    refundCents = Math.min(Math.max(0, captured - finalAmountCents), refundableBalance);
    supplementalCents = Math.max(0, finalAmountCents - captured);
  }

  const actions: SettlementAction[] = [];
  if (captureCents > 0) actions.push("capture");
  if (cancelAuthorization) actions.push("cancel_authorization");
  if (refundCents > 0) actions.push("refund");
  if (supplementalCents > 0) actions.push("collect_supplemental");
  if (actions.length === 0) actions.push("none");

  return {
    strategy,
    finalAmountCents,
    captureCents,
    cancelAuthorization,
    refundCents,
    supplementalCents,
    actions,
  };
}
