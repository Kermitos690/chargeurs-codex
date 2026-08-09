export const BRAND = {
  name: "Chargeurs.ch",
  supportEmail: "support@chargeurs.ch",
  website: "https://chargeurs.ch",
  legalUrls: {
    terms: "https://chargeurs.ch/legal/conditions",
    privacy: "https://chargeurs.ch/legal/confidentialite",
  },
  colors: {
    navy: "#0a1024",
    electricBlue: "#2764ff",
    violet: "#7b3ff2",
    qrForeground: "#0a1024",
    qrBackground: "#ffffff",
  },
  currency: "CHF",
  languages: ["fr", "en", "de"] as const,
} as const;

export type BrandLanguage = (typeof BRAND.languages)[number];
