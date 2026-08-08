/** Converts the authoritative per-period tariff into a customer-facing hourly rate. */
export function hourlyRateCents(pricePerPeriodCents: number, periodMinutes: number): number | null {
  if (!Number.isFinite(pricePerPeriodCents) || !Number.isFinite(periodMinutes) || pricePerPeriodCents <= 0 || periodMinutes <= 0) return null;
  return Math.round((pricePerPeriodCents * 60) / periodMinutes);
}
