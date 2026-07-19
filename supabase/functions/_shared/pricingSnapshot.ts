// Frozen rental pricing.
//
// A rental's final charge must be derived exclusively from the pricing rules
// embedded in rental_sessions.pricing_snapshot. Looking up the currently
// assigned profile would make an in-flight rental change price retroactively.

export type FrozenReturnState = "normal" | "not_returned";

export class PricingSnapshotError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "PricingSnapshotError";
  }
}

type FrozenRules = {
  currency: string;
  pricingRulesVersion: number;
  initialFeeCents: number;
  includedMinutes: number;
  periodMinutes: number;
  pricePerPeriodCents: number;
  graceMinutes: number;
  dailyCapCents: number;
  totalCapCents: number;
  maxAmountCents: number;
  depositCents: number;
  lateFeeCents: number;
  unreturnedFeeCents: number;
  unreturnedAfterMinutes: number;
  minAmountCents: number;
  rounding: "none" | "up_5" | "up_10";
  taxPercent: number;
};

function integerField(
  snapshot: Record<string, unknown>,
  key: string,
  options: { positive?: boolean } = {},
): number {
  const value = snapshot[key];
  if (!Number.isInteger(value) || Number(value) < 0 || (options.positive && Number(value) <= 0)) {
    throw new PricingSnapshotError(`PRICING_SNAPSHOT_INVALID_${key.toUpperCase()}`);
  }
  return Number(value);
}

function numericField(snapshot: Record<string, unknown>, key: string): number {
  const value = snapshot[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new PricingSnapshotError(`PRICING_SNAPSHOT_INVALID_${key.toUpperCase()}`);
  }
  return value;
}

function frozenRules(snapshot: Record<string, unknown>, expectedCurrency: string): FrozenRules {
  const pricingRulesVersion = integerField(snapshot, "pricing_rules_version", { positive: true });
  if (pricingRulesVersion !== 1) throw new PricingSnapshotError("PRICING_SNAPSHOT_VERSION_UNSUPPORTED");

  const currency = typeof snapshot.currency === "string" ? snapshot.currency.toUpperCase() : "";
  if (!currency || currency !== expectedCurrency.toUpperCase()) {
    throw new PricingSnapshotError("PRICING_SNAPSHOT_CURRENCY_MISMATCH");
  }

  const rounding = snapshot.rounding;
  if (rounding !== "none" && rounding !== "up_5" && rounding !== "up_10") {
    throw new PricingSnapshotError("PRICING_SNAPSHOT_INVALID_ROUNDING");
  }

  return {
    currency,
    pricingRulesVersion,
    initialFeeCents: integerField(snapshot, "initial_fee_cents"),
    includedMinutes: integerField(snapshot, "included_minutes"),
    periodMinutes: integerField(snapshot, "period_minutes", { positive: true }),
    pricePerPeriodCents: integerField(snapshot, "price_per_period_cents"),
    graceMinutes: integerField(snapshot, "grace_minutes"),
    dailyCapCents: integerField(snapshot, "daily_cap_cents"),
    totalCapCents: integerField(snapshot, "total_cap_cents"),
    maxAmountCents: integerField(snapshot, "max_amount_cents"),
    depositCents: integerField(snapshot, "deposit_cents"),
    lateFeeCents: integerField(snapshot, "late_fee_cents"),
    unreturnedFeeCents: integerField(snapshot, "unreturned_fee_cents"),
    unreturnedAfterMinutes: integerField(snapshot, "unreturned_after_minutes"),
    minAmountCents: integerField(snapshot, "min_amount_cents"),
    rounding,
    taxPercent: numericField(snapshot, "tax_percent"),
  };
}

function dateMillis(value: string, code: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new PricingSnapshotError(code);
  return parsed;
}

export function computeFinalPricingFromSnapshot(input: {
  snapshot: Record<string, unknown>;
  expectedCurrency: string;
  startAt: string;
  endAt: string;
  returnState: FrozenReturnState;
}): Record<string, unknown> {
  const rules = frozenRules(input.snapshot, input.expectedCurrency);
  const startMs = dateMillis(input.startAt, "PRICING_START_INVALID");
  const endMs = dateMillis(input.endAt, "PRICING_END_INVALID");
  const totalMinutes = Math.max(0, Math.ceil((endMs - startMs) / 60_000));
  const billableMinutes = totalMinutes <= rules.includedMinutes + rules.graceMinutes
    ? 0
    : totalMinutes - rules.includedMinutes;
  const billedPeriods = billableMinutes > 0
    ? Math.ceil(billableMinutes / rules.periodMinutes)
    : 0;

  const durationCents = billedPeriods * rules.pricePerPeriodCents;
  const nonReturn =
    input.returnState === "not_returned" ||
    (rules.unreturnedAfterMinutes > 0 && totalMinutes > rules.unreturnedAfterMinutes);
  // Chargeurs.ch defines unreturned_fee_cents as the total non-return charge,
  // not a surcharge added on top of accrued time. Fill only the difference so
  // the subtotal reaches that target and can never exceed max_amount_cents.
  const additionalFeesCents = nonReturn
    ? Math.max(0, rules.unreturnedFeeCents - rules.initialFeeCents - durationCents)
    : 0;

  const subtotalCents = rules.initialFeeCents + durationCents + additionalFeesCents;
  let cappedCents = subtotalCents;
  const capsApplied: Array<{ type: string; value: number }> = [];

  // The non-return total is a separate contractual outcome and must not be
  // reduced by the ordinary rental's daily/total duration caps.
  if (!nonReturn && rules.dailyCapCents > 0) {
    const billedDays = Math.max(1, Math.ceil(totalMinutes / 1440));
    const cap = rules.dailyCapCents * billedDays;
    if (cappedCents > cap) {
      cappedCents = cap;
      capsApplied.push({ type: "daily", value: cap });
    }
  }
  if (!nonReturn && rules.totalCapCents > 0 && cappedCents > rules.totalCapCents) {
    cappedCents = rules.totalCapCents;
    capsApplied.push({ type: "total", value: rules.totalCapCents });
  }
  if (rules.maxAmountCents > 0 && cappedCents > rules.maxAmountCents) {
    cappedCents = rules.maxAmountCents;
    capsApplied.push({ type: "max", value: rules.maxAmountCents });
  }
  if (rules.minAmountCents > 0 && cappedCents < rules.minAmountCents) {
    cappedCents = rules.minAmountCents;
    capsApplied.push({ type: "min", value: rules.minAmountCents });
  }

  if (rules.rounding === "up_5") cappedCents = Math.ceil(cappedCents / 5) * 5;
  if (rules.rounding === "up_10") cappedCents = Math.ceil(cappedCents / 10) * 10;

  const taxCents = Math.round(cappedCents * rules.taxPercent / 100);
  const finalCents = cappedCents + taxCents;

  return {
    profile_id: input.snapshot.profile_id,
    profile_name: input.snapshot.profile_name,
    profile_version: input.snapshot.profile_version,
    source: "rental_snapshot",
    pricing_rules_version: rules.pricingRulesVersion,
    currency: rules.currency,
    start: input.startAt,
    end: input.endAt,
    rental_state: "active",
    return_state: input.returnState,
    total_minutes: totalMinutes,
    billed_periods: billedPeriods,
    period_minutes: rules.periodMinutes,
    price_per_period_cents: rules.pricePerPeriodCents,
    initial_fee_cents: rules.initialFeeCents,
    duration_cents: durationCents,
    additional_fees_cents: additionalFeesCents,
    subtotal_cents: subtotalCents,
    caps_applied: capsApplied,
    tax_percent: rules.taxPercent,
    tax_cents: taxCents,
    final_cents: finalCents,
    amount: finalCents / 100,
    deposit_cents: rules.depositCents,
    computed_at: new Date().toISOString(),
  };
}
