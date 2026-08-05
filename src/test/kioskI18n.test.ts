import { describe, expect, it } from "vitest";
import { kioskTranslationKeys, translate, translations } from "@/i18n/i18n";
import { readFileSync } from "node:fs";

describe("kiosk translations", () => {
  it("contains every kiosk key in FR, EN and DE", () => {
    for (const lang of ["fr", "en", "de"] as const) {
      for (const key of kioskTranslationKeys) {
        expect(translations[lang][key], `${lang}:${key}`).toBeTruthy();
      }
    }
  });

  it("changes visible payment text immediately for English and German", () => {
    expect(translate("en", "kiosk.qr.title")).toBe("Scan to pay");
    expect(translate("de", "kiosk.qr.title")).toBe("Zum Bezahlen scannen");
    expect(translate("en", "kiosk.continue", { amount: "30.00 CHF" })).toContain("Continue");
    expect(translate("de", "kiosk.continue", { amount: "30.00 CHF" })).toContain("Weiter");
  });

  it("does not leave legacy French kiosk UI literals in the main rental path", () => {
    const source = readFileSync("src/pages/Kiosk.tsx", "utf8");
    for (const literal of [
      "Une erreur est survenue",
      "Génération du paiement",
      "Scannez ce QR code avec votre téléphone pour payer",
      "Continuer — garantie",
      "Batterie libérée !",
      "QR code expiré",
      "Paiement reçu",
    ]) {
      expect(source, literal).not.toContain(literal);
    }
  });
});
