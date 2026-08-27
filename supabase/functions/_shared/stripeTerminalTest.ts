export type TerminalPricingSource = {
  deposit_amount_cents?: unknown;
  pricing_snapshot?: Record<string, unknown> | null;
  currency?: unknown;
};

export type CanonicalPaymentRail = "NONE" | "TERMINAL" | "QR";
export type CanonicalPaymentRailState =
  | "UNCLAIMED"
  | "ENGAGED"
  | "PROCESSING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLING"
  | "CANCELLED"
  | "EXPIRED"
  | "RECOVERY_REQUIRED";

export function requireStripeTestKey(secretKey: string) {
  return secretKey.startsWith("sk_test_") || secretKey.startsWith("rk_test_");
}
export function canonicalTerminalAmountCents(session: TerminalPricingSource): number | null {
  const snapshot = session.pricing_snapshot ?? null;
  const amount = Math.round(Number(session.deposit_amount_cents ?? snapshot?.deposit_cents ?? 0));
  return Number.isInteger(amount) && amount > 0 ? amount : null;
}

export function canonicalTerminalCurrency(session: TerminalPricingSource): string | null {
  const currency = String(session.currency ?? "CHF").toLowerCase();
  return currency === "chf" ? "chf" : null;
}

export function terminalIntentIdempotencyKey(
  rentalSessionId: string,
  amountCents: number,
  pricingHash: string,
  generation = 1,
) {
  return `stripe_terminal_test:v2:${rentalSessionId}:${generation}:${amountCents}:${pricingHash || "nohash"}`;
}

export function terminalBindingUsable(binding: { enabled?: unknown; environment?: unknown; stripe_location_id?: unknown } | null | undefined) {
  return Boolean(
    binding &&
    binding.enabled === true &&
    binding.environment === "test" &&
    typeof binding.stripe_location_id === "string" &&
    binding.stripe_location_id.trim(),
  );
}

export function canonicalRail(raw: unknown, claimState?: unknown): CanonicalPaymentRail {
  if (claimState === "released" || !raw) return "NONE";
  if (raw === "stripe_terminal") return "TERMINAL";
  if (raw === "qr_checkout") return "QR";
  return "NONE";
}

export function terminalRailState(stripeStatus: unknown, claimState?: unknown): CanonicalPaymentRailState {
  if (claimState === "released") return "UNCLAIMED";
  if (claimState === "reconciliation_required") return "RECOVERY_REQUIRED";
  switch (stripeStatus) {
    case "requires_capture":
    case "succeeded": return "SUCCEEDED";
    case "processing": return "PROCESSING";
    case "canceled": return "CANCELLED";
    case "failed": return "FAILED";
    case "timed_out": return "EXPIRED";
    case "creating":
    case "requires_payment_method":
    case "requires_confirmation":
    case "requires_action": return "ENGAGED";
    default: return claimState === "engaged" ? "ENGAGED" : "UNCLAIMED";
  }
}

export function stripeIntentHasFinancialSideEffect(status: unknown): boolean {
  return ["processing", "requires_capture", "succeeded"].includes(String(status ?? ""));
}

export function stripeIntentSafelyCancelable(status: unknown): boolean {
  return ["requires_payment_method", "requires_confirmation", "requires_action", "processing"].includes(String(status ?? ""));
}
