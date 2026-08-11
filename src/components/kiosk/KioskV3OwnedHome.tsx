import { useLayoutEffect, useState } from "react";
import { HelpCircle, RefreshCw, UserRound, Zap } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { KioskPaymentMarks } from "@/components/kiosk/KioskPaymentMarks";
import { useI18n } from "@/i18n/i18n";

type HomeSnapshot = {
  visible: boolean;
  hourly: string;
  perHour: string;
  capLabel: string;
  cap: string;
  expressDisabled: boolean;
  clientDisabled: boolean;
};

const EMPTY: HomeSnapshot = {
  visible: false,
  hourly: "—",
  perHour: "",
  capLabel: "",
  cap: "—",
  expressDisabled: true,
  clientDisabled: true,
};

const COPY = {
  fr: {
    title: "Besoin d’une batterie ?",
    subtitle: "Choisissez votre parcours",
    expressKicker: "SANS COMPTE",
    expressTitle: "EXPRESS",
    expressBody: "Choisissez une batterie, payez sur votre téléphone et partez.",
    clientKicker: "AVEC COMPTE",
    clientTitle: "CLIENT CHARGEURS",
    clientBody: "Connectez votre compte et profitez automatiquement de votre tarif membre.",
    ready: "4 slots disponibles",
    refresh: "Actualiser",
    help: "Aide",
    secure: "Paiement sécurisé",
  },
  en: {
    title: "Need a battery?",
    subtitle: "Choose your journey",
    expressKicker: "NO ACCOUNT",
    expressTitle: "EXPRESS",
    expressBody: "Choose a powerbank, pay on your phone and go.",
    clientKicker: "WITH ACCOUNT",
    clientTitle: "CHARGEURS MEMBER",
    clientBody: "Connect your account and automatically use your member rate.",
    ready: "4 slots available",
    refresh: "Refresh",
    help: "Help",
    secure: "Secure payment",
  },
  de: {
    title: "Akku leer?",
    subtitle: "Wähle deinen Weg",
    expressKicker: "OHNE KONTO",
    expressTitle: "EXPRESS",
    expressBody: "Powerbank wählen, am Smartphone bezahlen und los.",
    clientKicker: "MIT KONTO",
    clientTitle: "CHARGEURS KUNDE",
    clientBody: "Konto verbinden und automatisch den Kundentarif nutzen.",
    ready: "4 Slots verfügbar",
    refresh: "Aktualisieren",
    help: "Hilfe",
    secure: "Sicher bezahlen",
  },
} as const;

function readHomeSnapshot(): HomeSnapshot {
  const home = document.querySelector<HTMLElement>(".ck2-home");
  if (!home) return EMPTY;

  const price = home.querySelector<HTMLElement>(".ck2-price-row");
  const strong = price ? Array.from(price.querySelectorAll("strong")) : [];
  const labels = price
    ? Array.from(price.children)
      .filter((node) => node.tagName === "SPAN" && !node.classList.contains("ck2-price-icon"))
      .map((node) => node.textContent?.trim() ?? "")
      .filter(Boolean)
    : [];
  const express = home.querySelector<HTMLButtonElement>(".ck2-choice-express");
  const client = home.querySelector<HTMLButtonElement>(".ck2-choice-member");

  return {
    visible: true,
    hourly: strong[0]?.textContent?.trim() || "—",
    perHour: labels[0] || "",
    capLabel: labels[1] || "",
    cap: strong[1]?.textContent?.trim() || "—",
    expressDisabled: !express || express.disabled,
    clientDisabled: !client || client.disabled,
  };
}

export function KioskV3OwnedHome() {
  const { lang } = useI18n();
  const copy = COPY[lang];
  const [snapshot, setSnapshot] = useState<HomeSnapshot>(() => readHomeSnapshot());
  const [refreshing, setRefreshing] = useState(false);

  useLayoutEffect(() => {
    const detect = () => setSnapshot(readHomeSnapshot());
    detect();
    const observer = new MutationObserver(detect);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["disabled", "class"],
      characterData: true,
    });
    return () => observer.disconnect();
  }, []);

  if (!snapshot.visible) return null;

  const clickUnderlying = (selector: string) => {
    const button = document.querySelector<HTMLButtonElement>(`.ck2-home ${selector}`);
    if (button && !button.disabled) button.click();
  };

  const refresh = () => {
    const button = document.querySelector<HTMLButtonElement>(".ck2-home .ck2-top-actions > .ck2-pill");
    if (!button || button.disabled) return;
    setRefreshing(true);
    button.click();
    window.setTimeout(() => setRefreshing(false), 900);
  };

  return (
    <section className="kv3-owned-home" aria-label="Chargeurs.ch">
      <div className="kv3-owned-home__glow kv3-owned-home__glow--green" aria-hidden="true" />
      <div className="kv3-owned-home__glow kv3-owned-home__glow--blue" aria-hidden="true" />

      <header className="kv3-owned-home__topbar">
        <BrandLogo size="md" />
        <nav className="kv3-owned-home__utilities" aria-label="Kiosk controls">
          <button type="button" onClick={refresh} disabled={refreshing} aria-label={copy.refresh} title={copy.refresh}>
            <RefreshCw className={refreshing ? "kv3-spin" : ""} />
          </button>
          <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("chargeurs:open-kiosk-help"))} aria-label={copy.help} title={copy.help}>
            <HelpCircle />
          </button>
          <div className="kv3-owned-home__language"><LanguageSwitcher /></div>
        </nav>
      </header>

      <main className="kv3-owned-home__body">
        <section className="kv3-owned-home__decision">
          <div className="kv3-owned-home__heading">
            <span>{copy.subtitle}</span>
            <h1>{copy.title}</h1>
          </div>

          <div className="kv3-owned-home__price" aria-label={`${snapshot.hourly} ${snapshot.perHour}`}>
            <span className="kv3-owned-home__price-icon"><Zap /></span>
            <strong>{snapshot.hourly}</strong>
            <span>{snapshot.perHour}</span>
            <i />
            <span>{snapshot.capLabel}</span>
            <strong>{snapshot.cap}</strong>
          </div>

          <div className="kv3-owned-home__choices">
            <button
              type="button"
              className="kv3-owned-home__choice kv3-owned-home__choice--express"
              disabled={snapshot.expressDisabled}
              onClick={() => clickUnderlying(".ck2-choice-express")}
            >
              <span className="kv3-owned-home__choice-icon"><Zap /></span>
              <span className="kv3-owned-home__choice-kicker">{copy.expressKicker}</span>
              <strong>{copy.expressTitle}</strong>
              <small>{copy.expressBody}</small>
              <b aria-hidden="true">→</b>
            </button>

            <button
              type="button"
              className="kv3-owned-home__choice kv3-owned-home__choice--client"
              disabled={snapshot.clientDisabled}
              onClick={() => clickUnderlying(".ck2-choice-member")}
            >
              <span className="kv3-owned-home__choice-icon"><UserRound /></span>
              <span className="kv3-owned-home__choice-kicker">{copy.clientKicker}</span>
              <strong>{copy.clientTitle}</strong>
              <small>{copy.clientBody}</small>
              <b aria-hidden="true">→</b>
            </button>
          </div>
        </section>

        <aside className="kv3-owned-home__station" aria-label={copy.ready}>
          <div className="kv3-owned-home__station-halo" aria-hidden="true" />
          <div className="kv3-owned-home__station-body">
            <div className="kv3-owned-home__station-screen">
              <BrandLogo size="sm" />
              <strong>{copy.ready}</strong>
            </div>
            <div className="kv3-owned-home__station-slots">
              {[1, 3, 2, 4].map((slot) => (
                <div key={slot}><span>{slot}</span><i /></div>
              ))}
            </div>
          </div>
          <div className="kv3-owned-home__station-floor" aria-hidden="true" />
        </aside>
      </main>

      <footer className="kv3-owned-home__payments" aria-label={copy.secure}>
        <span>{copy.secure}</span>
        <KioskPaymentMarks cardLabel="" />
      </footer>
    </section>
  );
}
