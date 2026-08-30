import { useEffect, useRef, useState } from "react";
import { ShieldCheck, Smartphone, Zap } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useI18n } from "@/i18n/i18n";
import Kiosk from "./Kiosk";

type PilotCopy = {
  eyebrow: string;
  title: string;
  subtitle: string;
  noAccount: string;
  phonePayment: string;
  secure: string;
  cta: string;
  returnNote: string;
};

const COPY: Record<"fr" | "en" | "de", PilotCopy> = {
  fr: {
    eyebrow: "LOCATION EXPRESS",
    title: "BESOIN DE BATTERIE ?",
    subtitle: "Louez une powerbank en quelques secondes.",
    noAccount: "Sans compte",
    phonePayment: "Paiement sur votre téléphone",
    secure: "Paiement sécurisé",
    cta: "LOUER UNE BATTERIE",
    returnNote: "Retour dans une borne Chargeurs.ch",
  },
  en: {
    eyebrow: "EXPRESS RENTAL",
    title: "NEED A POWERBANK?",
    subtitle: "Rent a powerbank in a few seconds.",
    noAccount: "No account",
    phonePayment: "Pay on your phone",
    secure: "Secure payment",
    cta: "RENT A POWERBANK",
    returnNote: "Return at a Chargeurs.ch station",
  },
  de: {
    eyebrow: "EXPRESS-MIETE",
    title: "POWERBANK GEBRAUCHT?",
    subtitle: "Mieten Sie in wenigen Sekunden eine Powerbank.",
    noAccount: "Ohne Konto",
    phonePayment: "Zahlung auf dem Smartphone",
    secure: "Sichere Zahlung",
    cta: "POWERBANK MIETEN",
    returnNote: "Rückgabe an einer Chargeurs.ch Station",
  },
};

/**
 * Pilot-only kiosk shell.
 *
 * This deliberately removes the member/account choice from the physical kiosk
 * without deleting the full customer journey from the product. The existing
 * Kiosk component remains the single transaction owner for pricing, session,
 * Stripe checkout, release and return state.
 */
export default function KioskGuestOnlyPilot() {
  const { lang } = useI18n();
  const copy = COPY[lang];
  const [started, setStarted] = useState(false);
  const protectedJourneySeen = useRef(false);

  useEffect(() => {
    if (!started) {
      protectedJourneySeen.current = false;
      return;
    }

    const inspect = () => {
      const protectedStage = Boolean(
        document.querySelector(
          ".kiosk-payment-rail-stage, .kiosk-qr-stage, .kiosk-release-stage, .kiosk-ready-stage",
        ),
      );
      if (protectedStage) protectedJourneySeen.current = true;

      // Kiosk resets itself to its idle scene after a completed/cancelled flow.
      // Only return to this pilot home if a protected journey was actually seen,
      // so the first normal idle render after pressing the CTA is not intercepted.
      if (protectedJourneySeen.current && document.querySelector(".kiosk-idle-stage")) {
        protectedJourneySeen.current = false;
        setStarted(false);
      }
    };

    inspect();
    const observer = new MutationObserver(inspect);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });

    const returnHome = () => setStarted(false);
    window.addEventListener("chargeurs:kiosk-return-home", returnHome);

    return () => {
      observer.disconnect();
      window.removeEventListener("chargeurs:kiosk-return-home", returnHome);
    };
  }, [started]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.kioskPilot = "guest-only";
    return () => {
      delete root.dataset.kioskPilot;
    };
  }, []);

  if (started) return <Kiosk />;

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-background px-6 py-8 text-foreground">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-background to-background" aria-hidden="true" />
      <section className="relative z-10 flex w-full max-w-3xl flex-col items-center rounded-[2.25rem] border border-border/70 bg-background/90 px-8 py-10 text-center shadow-2xl backdrop-blur-xl sm:px-12 sm:py-12">
        <div className="mb-8 flex w-full items-center justify-between gap-4">
          <BrandLogo size="md" />
          <LanguageSwitcher />
        </div>

        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 py-2 text-sm font-bold tracking-[0.16em] text-primary">
          <Zap className="h-4 w-4" aria-hidden="true" />
          {copy.eyebrow}
        </div>

        <h1 className="max-w-2xl font-display text-4xl font-black tracking-tight sm:text-6xl">{copy.title}</h1>
        <p className="mt-4 max-w-xl text-lg text-muted-foreground sm:text-xl">{copy.subtitle}</p>

        <div className="mt-8 grid w-full max-w-2xl gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-border bg-muted/35 px-4 py-4 font-semibold">{copy.noAccount}</div>
          <div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-muted/35 px-4 py-4 font-semibold">
            <Smartphone className="h-5 w-5 text-primary" aria-hidden="true" /> {copy.phonePayment}
          </div>
          <div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-muted/35 px-4 py-4 font-semibold">
            <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" /> {copy.secure}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setStarted(true)}
          className="mt-9 w-full max-w-xl rounded-full bg-primary px-8 py-6 text-xl font-black text-primary-foreground shadow-lg transition active:scale-[0.99]"
        >
          {copy.cta}
        </button>

        <p className="mt-5 text-sm font-medium text-muted-foreground">{copy.returnNote}</p>
      </section>
    </main>
  );
}
