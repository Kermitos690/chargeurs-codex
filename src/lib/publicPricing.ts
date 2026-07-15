export const PUBLIC_PRICING = {
  currency: "CHF",
  deposit: 30,
  hourlyRate: 1.5,
  incrementMinutes: 30,
  incrementPrice: 0.75,
  dailyCap: 18,
  nonReturnTotal: 99,
  nonReturnBalanceAfterDeposit: 69,
} as const;

export function formatChf(value: number) {
  return new Intl.NumberFormat("fr-CH", {
    style: "currency",
    currency: PUBLIC_PRICING.currency,
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value);
}

export function estimateRentalPrice(minutes: number) {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  const increments = Math.ceil(minutes / PUBLIC_PRICING.incrementMinutes);
  return Math.min(increments * PUBLIC_PRICING.incrementPrice, PUBLIC_PRICING.dailyCap);
}
