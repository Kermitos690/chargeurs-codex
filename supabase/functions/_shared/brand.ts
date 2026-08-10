// Server-side brand constants. This intentionally contains no secret and is
// kept in sync with src/config/brand.ts because Edge Functions run in Deno.
export const BRAND = {
  name: "Chargeurs.ch",
  supportEmail: "support@chargeurs.ch",
  website: "https://chargeurs.ch",
  currency: "CHF",
} as const;

export type CheckoutLocale = "fr" | "en" | "de";

export function checkoutLocale(value: unknown): CheckoutLocale {
  return value === "en" || value === "de" || value === "fr" ? value : "fr";
}

export function checkoutProductCopy(locale: CheckoutLocale): { name: string; description: string; depositLabel: string } {
  switch (locale) {
    case "en":
      return {
        name: "Chargeurs.ch — Powerbank rental",
        description: "CHF 0.75 per 30-minute period. A temporary CHF 30.00 guarantee is settled after return.",
        depositLabel: "Temporary rental guarantee",
      };
    case "de":
      return {
        name: "Chargeurs.ch — Powerbank-Miete",
        description: "CHF 0.75 pro 30 Minuten. Die temporäre Garantie von CHF 30.00 wird nach der Rückgabe abgerechnet.",
        depositLabel: "Temporäre Mietgarantie",
      };
    default:
      return {
        name: "Chargeurs.ch — Location de batterie externe",
        description: "0,75 CHF par période de 30 minutes. La garantie temporaire de 30,00 CHF est réglée après le retour.",
        depositLabel: "Garantie temporaire de location",
      };
  }
}
