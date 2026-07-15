// Fail-closed release gate for the first controlled Chargeurs.ch beta.
// These values are the confirmed business rules. The gate prevents an old or
// partially configured profile from creating a real payment or rental.
export const BETA_PRICING_RULES = {
  currency: "CHF",
  periodMinutes: 30,
  pricePerPeriodCents: 75,
  dailyCapCents: 1_800,
  depositCents: 3_000,
  unreturnedTotalCents: 9_900,
} as const;

export type BetaPriceProfile = {
  currency?: unknown;
  period_minutes?: unknown;
  price_per_period_cents?: unknown;
  daily_cap_cents?: unknown;
  deposit_cents?: unknown;
  unreturned_fee_cents?: unknown;
  max_amount_cents?: unknown;
  active?: unknown;
};

type EnvReader = (name: string) => string | undefined;

export function betaRentalsEnabled(
  readEnv: EnvReader = (name) => Deno.env.get(name),
): boolean {
  return readEnv("ENABLE_KIOSK_BETA_RENTALS") === "true";
}

export function validateBetaPriceProfile(profile: BetaPriceProfile | null): string | null {
  if (!profile || profile.active !== true) return "PRICING_PROFILE_INACTIVE";
  if (String(profile.currency ?? "").toUpperCase() !== BETA_PRICING_RULES.currency) {
    return "PRICING_CURRENCY_INVALID";
  }
  if (Number(profile.period_minutes) !== BETA_PRICING_RULES.periodMinutes) {
    return "PRICING_PERIOD_INVALID";
  }
  if (Number(profile.price_per_period_cents) !== BETA_PRICING_RULES.pricePerPeriodCents) {
    return "PRICING_RATE_INVALID";
  }
  if (Number(profile.daily_cap_cents) !== BETA_PRICING_RULES.dailyCapCents) {
    return "PRICING_DAILY_CAP_INVALID";
  }
  if (Number(profile.deposit_cents) !== BETA_PRICING_RULES.depositCents) {
    return "PRICING_DEPOSIT_INVALID";
  }
  if (Number(profile.unreturned_fee_cents) !== BETA_PRICING_RULES.unreturnedTotalCents) {
    return "PRICING_UNRETURNED_TOTAL_INVALID";
  }
  if (Number(profile.max_amount_cents) !== BETA_PRICING_RULES.unreturnedTotalCents) {
    return "PRICING_MAXIMUM_INVALID";
  }
  return null;
}
