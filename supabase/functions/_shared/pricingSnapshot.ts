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

type Tier = {
  upperMinutes: number;
  totalCents: number;
};

type FrozenRules = {
  currency: string;
  pricingRulesVersion: 1 | 2 | 3;
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
  tiered: boolean;
  tiers: Tier[];
};

type FrozenInput = {
  snapshot: Record<string, unknown>;
  startAt: string;
  endAt: string;
  returnState: FrozenReturnState;
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

function frozenTiers(snapshot: Record<string, unknown>, tiered: boolean): Tier[] {
  const rawTiers = snapshot.tiers;
  if (!tiered) {
    if (rawTiers == null) return [];
    if (!Array.isArray(rawTiers) || rawTiers.length !== 0) {
      throw new PricingSnapshotError("PRICING_SNAPSHOT_TIER_FLAG_MISMATCH");
    }
    return [];
  }
  if (!Array.isArray(rawTiers) || rawTiers.length === 0) {
    throw new PricingSnapshotError("PRICING_SNAPSHOT_INVALID_TIERS");
  }

  const tiers: Tier[] = [];
  for (const raw of rawTiers) {
    if (!raw || typeof raw !== "object") throw new PricingSnapshotError("PRICING_SNAPSHOT_INVALID_TIERS");
    const row = raw as Record<string, unknown>;
    if (!Number.isInteger(row.upper_minutes) || Number(row.upper_minutes) <= 0 || !Number.isInteger(row.total_cents) || Number(row.total_cents) < 0) {
      throw new PricingSnapshotError("PRICING_SNAPSHOT_INVALID_TIERS");
    }
    const tier = { upperMinutes: Number(row.upper_minutes), totalCents: Number(row.total_cents) };
    const previous = tiers[tiers.length - 1];
    if (previous && (tier.upperMinutes <= previous.upperMinutes || tier.totalCents < previous.totalCents)) {
      throw new PricingSnapshotError("PRICING_SNAPSHOT_INVALID_TIERS");
    }
    tiers.push(tier);
  }
  return tiers;
}

function frozenRules(snapshot: Record<string, unknown>, expectedCurrency: string): FrozenRules {
  const version = integerField(snapshot, "pricing_rules_version", { positive: true });
  if (version !== 1 && version !== 2 && version !== 3) {
    throw new PricingSnapshotError("PRICING_SNAPSHOT_VERSION_UNSUPPORTED");
  }

  const currency = typeof snapshot.currency === "string" ? snapshot.currency.toUpperCase() : "";
  if (!currency || currency !== expectedCurrency.toUpperCase()) {
    throw new PricingSnapshotError("PRICING_SNAPSHOT_CURRENCY_MISMATCH");
  }

  const rounding = snapshot.rounding;
  if (rounding !== "none" && rounding !== "up_5" && rounding !== "up_10") {
    throw new PricingSnapshotError("PRICING_SNAPSHOT_INVALID_ROUNDING");
  }

  const tiered = version >= 2 && snapshot.tiered === true;
  if (version === 1 && snapshot.tiered === true) {
    throw new PricingSnapshotError("PRICING_SNAPSHOT_VERSION_TIER_MISMATCH");
  }

  return {
    currency,
    pricingRulesVersion: version,
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
    tiered,
    tiers: frozenTiers(snapshot, tiered),
  };
}

function dateMillis(value: string, code: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new PricingSnapshotError(code);
  return parsed;
}

function applyRoundingAndTax(rules: FrozenRules, cappedCents: number) {
  if (rules.rounding === "up_5") cappedCents = Math.ceil(cappedCents / 5) * 5;
  if (rules.rounding === "up_10") cappedCents = Math.ceil(cappedCents / 10) * 10;
  const taxCents = Math.round(cappedCents * rules.taxPercent / 100);
  return { cappedCents, taxCents, finalCents: cappedCents + taxCents };
}

function computeV1(rules: FrozenRules, input: FrozenInput, totalMinutes: number): Record<string, unknown> {
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

  // Preserve v1 historical semantics exactly: unreturned_fee_cents is the
  // target total non-return charge and ordinary duration caps do not reduce it.
  const additionalFeesCents = nonReturn
    ? Math.max(0, rules.unreturnedFeeCents - rules.initialFeeCents - durationCents)
    : 0;
  const subtotalCents = rules.initialFeeCents + durationCents + additionalFeesCents;
  let cappedCents = subtotalCents;
  const capsApplied: Array<{ type: string; value: number }> = [];

  if (!nonReturn && rules.dailyCapCents > 0) {
    const billedDays = Math.max(1, Math.ceil(totalMinutes / 1440));
    const cap = rules.dailyCapCents * billedDays;
    if (cappedCents > cap) { cappedCents = cap; capsApplied.push({ type: "daily", value: cap }); }
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
  const finalized = applyRoundingAndTax(rules, cappedCents);

  return {
    profile_id: input.snapshot.profile_id,
    profile_name: input.snapshot.profile_name,
    profile_version: input.snapshot.profile_version,
    source: "rental_snapshot",
    pricing_rules_version: 1,
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
    tax_cents: finalized.taxCents,
    final_cents: finalized.finalCents,
    amount: finalized.finalCents / 100,
    deposit_cents: rules.depositCents,
    computed_at: new Date().toISOString(),
  };
}

function durationPricing(rules: FrozenRules, totalMinutes: number) {
  let billedPeriods = 0;
  let durationCents = 0;
  let initialFeeCents = rules.initialFeeCents;

  if (rules.tiered) {
    // Tier totals already represent the complete duration price.
    initialFeeCents = 0;
    const targetMinutes = Math.max(totalMinutes, 1);
    const tier = rules.tiers.find((candidate) => candidate.upperMinutes >= targetMinutes);
    if (tier) {
      durationCents = tier.totalCents;
    } else {
      const last = rules.tiers[rules.tiers.length - 1];
      billedPeriods = Math.ceil((totalMinutes - last.upperMinutes) / rules.periodMinutes);
      durationCents = last.totalCents + billedPeriods * rules.pricePerPeriodCents;
    }
  } else {
    const billableMinutes = totalMinutes <= rules.includedMinutes + rules.graceMinutes
      ? 0
      : totalMinutes - rules.includedMinutes;
    billedPeriods = billableMinutes > 0 ? Math.ceil(billableMinutes / rules.periodMinutes) : 0;
    durationCents = billedPeriods * rules.pricePerPeriodCents;
  }

  return { billedPeriods, durationCents, initialFeeCents };
}

function commonSnapshotFields(
  rules: FrozenRules,
  input: FrozenInput,
  totalMinutes: number,
  pricingRulesVersion: 2 | 3,
  values: {
    billedPeriods: number;
    durationCents: number;
    initialFeeCents: number;
    additionalFeesCents: number;
    subtotalCents: number;
    capsApplied: Array<{ type: string; value: number }>;
    finalized: { taxCents: number; finalCents: number };
    nonReturnTotalApplied?: boolean;
  },
): Record<string, unknown> {
  return {
    profile_id: input.snapshot.profile_id,
    profile_name: input.snapshot.profile_name,
    profile_version: input.snapshot.profile_version,
    source: "rental_snapshot",
    pricing_rules_version: pricingRulesVersion,
    currency: rules.currency,
    start: input.startAt,
    end: input.endAt,
    rental_state: "active",
    return_state: input.returnState,
    total_minutes: totalMinutes,
    billed_periods: values.billedPeriods,
    period_minutes: rules.periodMinutes,
    price_per_period_cents: rules.pricePerPeriodCents,
    initial_fee_cents: values.initialFeeCents,
    duration_cents: values.durationCents,
    additional_fees_cents: values.additionalFeesCents,
    subtotal_cents: values.subtotalCents,
    caps_applied: values.capsApplied,
    tax_percent: rules.taxPercent,
    tax_cents: values.finalized.taxCents,
    final_cents: values.finalized.finalCents,
    amount: values.finalized.finalCents / 100,
    deposit_cents: rules.depositCents,
    tiered: rules.tiered,
    tiers: rules.tiers.map((tier) => ({ upper_minutes: tier.upperMinutes, total_cents: tier.totalCents })),
    included_minutes: rules.includedMinutes,
    grace_minutes: rules.graceMinutes,
    daily_cap_cents: rules.dailyCapCents,
    total_cap_cents: rules.totalCapCents,
    max_amount_cents: rules.maxAmountCents,
    min_amount_cents: rules.minAmountCents,
    late_fee_cents: rules.lateFeeCents,
    unreturned_fee_cents: rules.unreturnedFeeCents,
    unreturned_after_minutes: rules.unreturnedAfterMinutes,
    ...(pricingRulesVersion === 3 ? { non_return_total_applied: values.nonReturnTotalApplied === true } : {}),
    computed_at: new Date().toISOString(),
  };
}

function computeV2(rules: FrozenRules, input: FrozenInput, totalMinutes: number): Record<string, unknown> {
  const { billedPeriods, durationCents, initialFeeCents } = durationPricing(rules, totalMinutes);

  // Preserve v2 historical semantics exactly: the configured non-return amount
  // is additive and ordinary caps are still applied afterwards.
  const nonReturn =
    input.returnState === "not_returned" ||
    (rules.unreturnedAfterMinutes > 0 && totalMinutes >= rules.unreturnedAfterMinutes);
  const additionalFeesCents = nonReturn ? rules.unreturnedFeeCents : 0;
  const subtotalCents = initialFeeCents + durationCents + additionalFeesCents;
  let cappedCents = subtotalCents;
  const capsApplied: Array<{ type: string; value: number }> = [];

  if (!rules.tiered && rules.dailyCapCents > 0) {
    const billedDays = Math.max(1, Math.ceil(totalMinutes / 1440));
    const cap = rules.dailyCapCents * billedDays;
    if (cappedCents > cap) { cappedCents = cap; capsApplied.push({ type: "daily", value: cap }); }
  }
  if (rules.totalCapCents > 0 && cappedCents > rules.totalCapCents) {
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

  return commonSnapshotFields(rules, input, totalMinutes, 2, {
    billedPeriods,
    durationCents,
    initialFeeCents,
    additionalFeesCents,
    subtotalCents,
    capsApplied,
    finalized: applyRoundingAndTax(rules, cappedCents),
  });
}

function computeV3(rules: FrozenRules, input: FrozenInput, totalMinutes: number): Record<string, unknown> {
  const { billedPeriods, durationCents, initialFeeCents } = durationPricing(rules, totalMinutes);
  const baseSubtotalCents = initialFeeCents + durationCents;
  const nonReturn =
    input.returnState === "not_returned" ||
    (rules.unreturnedAfterMinutes > 0 && totalMinutes >= rules.unreturnedAfterMinutes);

  // v3 pilot semantics: unreturned_fee_cents is the contractual TOTAL amount.
  // Ordinary duration/day caps are bypassed once the 72h non-return threshold is
  // reached. v1/v2 snapshots remain frozen under their historical semantics.
  let additionalFeesCents = 0;
  let subtotalCents = baseSubtotalCents;
  let cappedCents = subtotalCents;
  const capsApplied: Array<{ type: string; value: number }> = [];

  if (nonReturn) {
    additionalFeesCents = Math.max(0, rules.unreturnedFeeCents - baseSubtotalCents);
    subtotalCents = baseSubtotalCents + additionalFeesCents;
    cappedCents = rules.unreturnedFeeCents;
    capsApplied.push({ type: "non_return_total", value: rules.unreturnedFeeCents });
  } else {
    if (!rules.tiered && rules.dailyCapCents > 0) {
      const billedDays = Math.max(1, Math.ceil(totalMinutes / 1440));
      const cap = rules.dailyCapCents * billedDays;
      if (cappedCents > cap) { cappedCents = cap; capsApplied.push({ type: "daily", value: cap }); }
    }
    if (rules.totalCapCents > 0 && cappedCents > rules.totalCapCents) {
      cappedCents = rules.totalCapCents;
      capsApplied.push({ type: "total", value: rules.totalCapCents });
    }
    if (rules.minAmountCents > 0 && cappedCents < rules.minAmountCents) {
      cappedCents = rules.minAmountCents;
      capsApplied.push({ type: "min", value: rules.minAmountCents });
    }
  }

  // max_amount_cents remains a final safety ceiling even for non-return.
  if (rules.maxAmountCents > 0 && cappedCents > rules.maxAmountCents) {
    cappedCents = rules.maxAmountCents;
    capsApplied.push({ type: "max", value: rules.maxAmountCents });
  }

  return commonSnapshotFields(rules, input, totalMinutes, 3, {
    billedPeriods,
    durationCents,
    initialFeeCents,
    additionalFeesCents,
    subtotalCents,
    capsApplied,
    finalized: applyRoundingAndTax(rules, cappedCents),
    nonReturnTotalApplied: nonReturn,
  });
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
  if (endMs < startMs) throw new PricingSnapshotError("PRICING_DATE_INVALID");
  const totalMinutes = Math.max(0, Math.ceil((endMs - startMs) / 60_000));

  if (rules.pricingRulesVersion === 1) return computeV1(rules, input, totalMinutes);
  if (rules.pricingRulesVersion === 2) return computeV2(rules, input, totalMinutes);
  return computeV3(rules, input, totalMinutes);
}
