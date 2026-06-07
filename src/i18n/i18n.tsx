import { createContext, useContext, useEffect, useState, ReactNode } from "react";

export type Lang = "fr" | "en" | "de";

type Dict = Record<string, string>;

const fr: Dict = {
  "brand": "Chargeurs.ch",
  "kiosk.hero": "Rechargez votre téléphone. Continuez votre soirée.",
  "kiosk.subtitle": "Scannez, payez avec TWINT, Apple Pay, Google Pay ou carte, puis retirez votre batterie.",
  "kiosk.cta": "Louer une batterie",
  "kiosk.available": "batteries disponibles",
  "kiosk.price": "Prix",
  "kiosk.online": "Borne en ligne",
  "kiosk.offline": "Borne hors ligne",
  "kiosk.unavailable": "Aucune batterie disponible pour le moment",
  "kiosk.notconfigured": "API non configurée — données réelles indisponibles",
  "kiosk.loading": "Connexion à la borne…",
  "qr.title": "Scannez ce QR code avec votre téléphone.",
  "qr.secured": "Paiement sécurisé par Stripe.",
  "qr.methods": "Compatible TWINT, Apple Pay, Google Pay et cartes.",
  "qr.waiting": "En attente du paiement…",
  "qr.cancel": "Annuler",
  "success.title": "Paiement confirmé. Votre batterie est prête.",
  "success.sub": "Retirez votre batterie de la borne.",
  "error.generic": "Un problème est survenu. Aucun montant ne sera perdu : notre système vérifie automatiquement la transaction.",
  "error.retry": "Réessayer",
  "error.support": "Notre équipe a été alertée. Contactez le support si besoin.",
  "pay.title": "Paiement Chargeurs.ch",
  "pay.open": "Ouvrir le paiement sécurisé",
  "pay.pending": "Paiement en attente…",
  "pay.methods": "Apple Pay, Google Pay et TWINT sont disponibles via Stripe.",
  "pay.return": "Retournez à la borne pour récupérer votre batterie.",
};

const en: Dict = {
  "brand": "Chargeurs.ch",
  "kiosk.hero": "Charge your phone. Keep your night going.",
  "kiosk.subtitle": "Scan, pay with TWINT, Apple Pay, Google Pay or card, then take your powerbank.",
  "kiosk.cta": "Rent a powerbank",
  "kiosk.available": "powerbanks available",
  "kiosk.price": "Price",
  "kiosk.online": "Station online",
  "kiosk.offline": "Station offline",
  "kiosk.unavailable": "No powerbank available right now",
  "kiosk.notconfigured": "API not configured — live data unavailable",
  "kiosk.loading": "Connecting to station…",
  "qr.title": "Scan this QR code with your phone.",
  "qr.secured": "Secured payment by Stripe.",
  "qr.methods": "Works with TWINT, Apple Pay, Google Pay and cards.",
  "qr.waiting": "Waiting for payment…",
  "qr.cancel": "Cancel",
  "success.title": "Payment confirmed. Your powerbank is ready.",
  "success.sub": "Take your powerbank from the station.",
  "error.generic": "Something went wrong. No money is lost: our system verifies the transaction automatically.",
  "error.retry": "Try again",
  "error.support": "Our team has been alerted. Contact support if needed.",
  "pay.title": "Chargeurs.ch payment",
  "pay.open": "Open secure payment",
  "pay.pending": "Payment pending…",
  "pay.methods": "Apple Pay, Google Pay and TWINT are available via Stripe.",
  "pay.return": "Return to the station to collect your powerbank.",
};

const de: Dict = {
  "brand": "Chargeurs.ch",
  "kiosk.hero": "Lade dein Handy. Geniesse deinen Abend.",
  "kiosk.subtitle": "Scannen, mit TWINT, Apple Pay, Google Pay oder Karte zahlen, dann Powerbank entnehmen.",
  "kiosk.cta": "Powerbank mieten",
  "kiosk.available": "Powerbanks verfügbar",
  "kiosk.price": "Preis",
  "kiosk.online": "Station online",
  "kiosk.offline": "Station offline",
  "kiosk.unavailable": "Momentan keine Powerbank verfügbar",
  "kiosk.notconfigured": "API nicht konfiguriert — keine Echtdaten",
  "kiosk.loading": "Verbinde mit Station…",
  "qr.title": "Scanne diesen QR-Code mit deinem Handy.",
  "qr.secured": "Sichere Zahlung über Stripe.",
  "qr.methods": "Funktioniert mit TWINT, Apple Pay, Google Pay und Karten.",
  "qr.waiting": "Warte auf Zahlung…",
  "qr.cancel": "Abbrechen",
  "success.title": "Zahlung bestätigt. Deine Powerbank ist bereit.",
  "success.sub": "Entnimm deine Powerbank aus der Station.",
  "error.generic": "Ein Fehler ist aufgetreten. Es geht kein Geld verloren: Das System prüft die Transaktion automatisch.",
  "error.retry": "Erneut versuchen",
  "error.support": "Unser Team wurde benachrichtigt. Kontaktiere bei Bedarf den Support.",
  "pay.title": "Chargeurs.ch Zahlung",
  "pay.open": "Sichere Zahlung öffnen",
  "pay.pending": "Zahlung ausstehend…",
  "pay.methods": "Apple Pay, Google Pay und TWINT sind über Stripe verfügbar.",
  "pay.return": "Gehe zur Station zurück, um deine Powerbank zu holen.",
};

const dicts: Record<Lang, Dict> = { fr, en, de };

interface I18nCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string) => string;
}

const Ctx = createContext<I18nCtx>({ lang: "fr", setLang: () => {}, t: (k) => k });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem("lang") as Lang) || "fr");
  useEffect(() => { localStorage.setItem("lang", lang); }, [lang]);
  const t = (key: string) => dicts[lang][key] ?? dicts.fr[key] ?? key;
  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);
export const LANGS: Lang[] = ["fr", "en", "de"];
