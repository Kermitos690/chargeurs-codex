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
    expect(translate("en", "pay.title")).toBe("Payment verification in progress");
    expect(translate("de", "qr.secured")).toBe("Sichere Zahlung über Stripe");
  });

  it("defines every hosted-payment page key in FR, EN and DE", () => {
    for (const lang of ["fr", "en", "de"] as const) {
      for (const key of ["pay.title", "pay.pending", "pay.open", "pay.methods", "pay.return", "qr.secured"]) {
        expect(translate(lang, key), `${lang}:${key}`).not.toBe(key);
      }
    }
  });

  it("translates the battery-choice screen without falling back to French", () => {
    const keys = ["kiosk.choose.title", "kiosk.choose.subtitle", "kiosk.rent_selected", "kiosk.slot.ready", "kiosk.slot.checking", "kiosk.slot.charge_unknown", "kiosk.slot.selected", "kiosk.qr.phone", "kiosk.qr.card", "kiosk.qr.eligibility", "kiosk.refresh", "kiosk.inactivity.return_in", "kiosk.inactivity.close", "kiosk.ad.preview", "kiosk.ad.title"];
    for (const key of keys) {
      expect(translate("en", key), `en:${key}`).not.toBe(translations.fr[key]);
      expect(translate("de", key), `de:${key}`).not.toBe(translations.fr[key]);
    }
  });

  it("labels the non-idle kiosk timeout in every public language", () => {
    expect(translate("fr", "kiosk.inactivity.return_in", { seconds: 35 })).toBe("Menu dans 35 s");
    expect(translate("en", "kiosk.inactivity.return_in", { seconds: 35 })).toBe("Menu in 35 s");
    expect(translate("de", "kiosk.inactivity.return_in", { seconds: 35 })).toBe("Menü in 35 s");
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

  it("keeps the guarantee out of the idle and QR customer screens", () => {
    const source = readFileSync("src/pages/Kiosk.tsx", "utf8");
    const idle = source.slice(source.indexOf('{phase === "idle" && station'), source.indexOf('{phase === "pricing"'));
    const qr = source.slice(source.indexOf('{phase === "qr"'), source.indexOf('{phase === "waitpay"'));
    expect(idle).not.toContain("kiosk.pricing.guarantee");
    expect(qr).not.toContain("kiosk.pricing.guarantee");
  });
});
