export type TerminalPricingSource = {
  deposit_amount_cents?: unknown;
  pricing_snapshot?: Record<string, unknown> | null;
  currency?: unknown;
};

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

export function terminalIntentIdempotencyKey(rentalSessionId: string, amountCents: number, pricingHash: string) {
  return `stripe_terminal_test:v1:${rentalSessionId}:${amountCents}:${pricingHash || "nohash"}`;
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
