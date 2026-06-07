// Pure payment-integrity decision logic shared between the Stripe webhook and
// the automated integration harness. Keeping it pure (no I/O) means the tests
// exercise the EXACT production rules that gate battery ejection.
//
// Rules (never trust client/Stripe metadata blindly):
//  - Paid amount (in cents) must equal the server-computed expected amount,
//    unless the expected amount is 0 (free / not amount-gated).
//  - Currency must match the session currency (case-insensitive) when present.
//  - The pricing snapshot hash recomputed from the DB snapshot must equal the
//    stored hash, and any hash carried in Stripe metadata must also match.

export interface PaymentMatchInput {
  expectedCents: number;
  paidCents: number;
  expectedCurrency: string;
  paidCurrency: string;
  hasSnapshot: boolean;
  storedHash: string | null;
  recomputedHash: string | null;
  metaHash: string | null;
}

export interface PaymentMatchResult {
  amountOk: boolean;
  currencyOk: boolean;
  snapshotOk: boolean;
  ok: boolean;
  failureCode: "SNAPSHOT_MISMATCH" | "AMOUNT_MISMATCH" | null;
}

export function evaluatePaymentMatch(i: PaymentMatchInput): PaymentMatchResult {
  const amountOk = i.expectedCents === 0 || i.paidCents === i.expectedCents;
  const ec = (i.expectedCurrency ?? "CHF").toLowerCase();
  const pc = (i.paidCurrency ?? "").toLowerCase();
  const currencyOk = !pc || pc === ec;

  let snapshotOk = true;
  if (i.hasSnapshot) {
    snapshotOk = i.recomputedHash === i.storedHash && (!i.metaHash || i.metaHash === i.storedHash);
  }

  const ok = amountOk && currencyOk && snapshotOk;
  const failureCode = ok ? null : (!snapshotOk ? "SNAPSHOT_MISMATCH" : "AMOUNT_MISMATCH");
  return { amountOk, currencyOk, snapshotOk, ok, failureCode };
}

// Refund safety: never refund more than was captured; always operate on integer
// cents; an already-refunded payment is a no-op (idempotent).
export interface RefundDecisionInput {
  capturedCents: number;
  requestedCents: number; // 0 or negative => treat as full refund
  alreadyRefundedCents: number;
}
export interface RefundDecisionResult {
  ok: boolean;
  refundCents: number;
  error: "NOTHING_CAPTURED" | "EXCEEDS_CAPTURED" | "ALREADY_REFUNDED" | null;
}
export function evaluateRefund(i: RefundDecisionInput): RefundDecisionResult {
  if (i.capturedCents <= 0) return { ok: false, refundCents: 0, error: "NOTHING_CAPTURED" };
  const remaining = i.capturedCents - i.alreadyRefundedCents;
  if (remaining <= 0) return { ok: false, refundCents: 0, error: "ALREADY_REFUNDED" };
  const want = i.requestedCents > 0 ? Math.round(i.requestedCents) : remaining;
  if (want > remaining) return { ok: false, refundCents: 0, error: "EXCEEDS_CAPTURED" };
  return { ok: true, refundCents: want, error: null };
}
