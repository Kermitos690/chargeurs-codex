export const PUBLIC_PRICING = {
  currency: "CHF",
  deposit: 0,
  depositChf: 0,
  startingPrice: 1.9,
  startingPriceChf: 1.9,
  incrementMinutes: 30,
  incrementPrice: 1.9,
  dailyCap: 7.9,
  dailyCapChf: 7.9,
  nonReturnTotal: 29.9,
  nonReturnTotalChf: 29.9,
  nonReturnBalanceAfterDeposit: 29.9,
  tiers: [
    { upperMinutes: 30, amount: 1.9 },
    { upperMinutes: 120, amount: 3.9 },
    { upperMinutes: 360, amount: 5.9 },
    { upperMinutes: 1440, amount: 7.9 },
  ],
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
  const tier = PUBLIC_PRICING.tiers.find(({ upperMinutes }) => minutes <= upperMinutes);
  if (tier) return tier.amount;
  const extraDays = Math.ceil((minutes - 1440) / 1440);
  return Math.min(PUBLIC_PRICING.dailyCap + extraDays * PUBLIC_PRICING.dailyCap, PUBLIC_PRICING.nonReturnTotal);
}

export const priceForMinutes = estimateRentalPrice;
export const quotePublicRental = estimateRentalPrice;
