import { useCallback, useLayoutEffect, useState, type CSSProperties } from "react";
import { useParams } from "react-router-dom";
import { HelpCircle, RefreshCw, UserRound, Zap } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { KioskPaymentMarks } from "@/components/kiosk/KioskPaymentMarks";
import { useI18n } from "@/i18n/i18n";
import { readKioskToken } from "@/lib/kioskFetch";
import { invokeKioskEdgeProxy } from "@/lib/kioskEdgeProxy";

type PricingTier = {
  upper_minutes: number;
  total_cents: number;
};

type GuestPricing = {
  currency?: string;
  tiered?: boolean;
  tiers?: PricingTier[];
  starting_cents?: number;
  hourly_cents?: number | null;
  daily_cap_cents?: number;
  total_cap_cents?: number;
};

type CustomerOptions = {
  ok?: boolean;
  guest?: GuestPricing;
};

type HomeSnapshot = {
  visible: boolean;
  expressDisabled: boolean;
  clientDisabled: boolean;
};

const EMPTY: HomeSnapshot = {
  visible: false,
  expressDisabled: true,
  clientDisabled: true,
};

const COPY = {
  fr: {
    title: "Besoin d’une batterie ?",
    subtitle: "Choisissez votre parcours",
    expressKicker: "SANS COMPTE",
    expressTitle: "EXPRESS",
    expressBody: "Consultez le tarif, choisissez votre batterie, payez et partez.",
    clientKicker: "AVEC COMPTE",
    clientTitle: "CLIENT CHARGEURS",
    clientBody: "Connectez votre compte et profitez automatiquement de votre tarif membre.",
    ready: "4 slots disponibles",
    refresh: "Actualiser",
    help: "Aide",
    secure: "Paiement sécurisé",
    from: "Dès",
    upTo: "jusqu’à",
    totalCap: "plafond total",
    pricingUnavailable: "Tarif en cours de chargement",
  },
  en: {
    title: "Need a battery?",
    subtitle: "Choose your journey",
    expressKicker: "NO ACCOUNT",
    expressTitle: "EXPRESS",
    expressBody: "See the price first, choose a powerbank, pay and go.",
    clientKicker: "WITH ACCOUNT",
    clientTitle: "CHARGEURS MEMBER",
    clientBody: "Connect your account and automatically use your member rate.",
    ready: "4 slots available",
    refresh: "Refresh",
    help: "Help",
    secure: "Secure payment",
    from: "From",
    upTo: "up to",
    totalCap: "total cap",
    pricingUnavailable: "Loading price",
  },
  de: {
    title: "Akku leer?",
    subtitle: "Wähle deinen Weg",
    expressKicker: "OHNE KONTO",
    expressTitle: "EXPRESS",
    expressBody: "Preis zuerst ansehen, Powerbank wählen, bezahlen und los.",
    clientKicker: "MIT KONTO",
    clientTitle: "CHARGEURS KUNDE",
    clientBody: "Konto verbinden und automatisch den Kundentarif nutzen.",
    ready: "4 Slots verfügbar",
    refresh: "Aktualisieren",
    help: "Hilfe",
    secure: "Sicher bezahlen",
    from: "Ab",
    upTo: "bis",
    totalCap: "Gesamtlimit",
    pricingUnavailable: "Preis wird geladen",
  },
} as const;

function readHomeSnapshot(): HomeSnapshot {
  const home = document.querySelector<HTMLElement>(".ck2-home");
  if (!home) return EMPTY;
  const express = home.querySelector<HTMLButtonElement>(".ck2-choice-express");
  const client = home.querySelector<HTMLButtonElement>(".ck2-choice-member");
  return {
    visible: true,
    expressDisabled: !express || express.disabled,
    clientDisabled: !client || client.disabled,
  };
}

function readCanvasScale() {
  if (typeof window === "undefined") return 1;
  return Math.min(window.innerWidth / 1280, window.innerHeight / 720);
}

function money(cents: number | null | undefined, currency: string) {
  if (cents == null || !Number.isFinite(cents)) return "—";
  return `${currency} ${(Number(cents) / 100).toFixed(2)}`;
}

function durationLabel(minutes: number, lang: "fr" | "en" | "de") {
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return lang === "de" ? `${days} Tag${days > 1 ? "e" : ""}` : lang === "en" ? `${days} day${days > 1 ? "s" : ""}` : `${days} jour${days > 1 ? "s" : ""}`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return lang === "de" ? `${hours} Std.` : lang === "en" ? `${hours} h` : `${hours} h`;
  }
  return `${minutes} min`;
}

export function KioskV3OwnedHome() {
  const { stationId = "" } = useParams();
  const { lang } = useI18n();
  const copy = COPY[lang];
  const [snapshot, setSnapshot] = useState<HomeSnapshot>(() => readHomeSnapshot());
  const [guestPricing, setGuestPricing] = useState<GuestPricing | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [canvasScale, setCanvasScale] = useState(() => readCanvasScale());

  const loadPricing = useCallback(async () => {
    const token = readKioskToken();
    if (!stationId || !token) {
      setGuestPricing(null);
      return;
    }
    const { data } = await invokeKioskEdgeProxy<CustomerOptions>(
      "/api/kiosk/customer-options",
      { stationId },
      { "X-Kiosk-Token": token },
    );
    setGuestPricing(data?.ok && data.guest ? data.guest : null);
  }, [stationId]);

  useLayoutEffect(() => {
    const detect = () => setSnapshot(readHomeSnapshot());
    const resize = () => setCanvasScale(readCanvasScale());
    detect();
    resize();
    void loadPricing();
    const observer = new MutationObserver(detect);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["disabled", "class"],
      characterData: true,
    });
    window.addEventListener("resize", resize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [loadPricing]);

  if (!snapshot.visible) return null;

  const clickUnderlying = (selector: string) => {
    const button = document.querySelector<HTMLButtonElement>(`.ck2-home ${selector}`);
    if (button && !button.disabled) button.click();
  };

  const refresh = async () => {
    const button = document.querySelector<HTMLButtonElement>(".ck2-home .ck2-top-actions > .ck2-pill");
    setRefreshing(true);
    try {
      if (button && !button.disabled) button.click();
      await loadPricing();
    } finally {
      window.setTimeout(() => setRefreshing(false), 700);
    }
  };

  const canvasStyle = { "--kv5-scale": String(canvasScale) } as CSSProperties;
  const currency = guestPricing?.currency ?? "CHF";
  const tiers = Array.isArray(guestPricing?.tiers) ? guestPricing!.tiers!.filter((tier) => tier.upper_minutes > 0 && tier.total_cents > 0).sort((a, b) => a.upper_minutes - b.upper_minutes) : [];
  const firstTier = tiers[0];
  const dayTier = tiers.find((tier) => tier.upper_minutes === 1440) ?? tiers[tiers.length - 1];
  const tiered = guestPricing?.tiered === true && Boolean(firstTier && dayTier);

  const primaryPrice = tiered
    ? `${copy.from} ${money(firstTier.total_cents, currency)} / ${durationLabel(firstTier.upper_minutes, lang)}`
    : guestPricing?.hourly_cents != null
      ? `${money(guestPricing.hourly_cents, currency)} / h`
      : copy.pricingUnavailable;
  const secondaryPrice = tiered
    ? `${copy.upTo} ${money(dayTier.total_cents, currency)} / ${durationLabel(dayTier.upper_minutes, lang)}`
    : guestPricing?.daily_cap_cents
      ? `${money(guestPricing.daily_cap_cents, currency)} / jour`
      : "";
  const capPrice = guestPricing?.total_cap_cents ? `${copy.totalCap} ${money(guestPricing.total_cap_cents, currency)}` : "";

  return (
    <section className="kv3-owned-home kv5-reference-home" style={canvasStyle} aria-label="Chargeurs.ch">
      <div className="kv5-home-ambient kv5-home-ambient--green" aria-hidden="true" />
      <div className="kv5-home-ambient kv5-home-ambient--blue" aria-hidden="true" />

      <header className="kv3-owned-home__topbar kv5-home-topbar">
        <div className="kv5-home-brand"><BrandLogo size="md" /></div>
        <nav className="kv3-owned-home__utilities kv5-home-utilities" aria-label="Kiosk controls">
          <button type="button" onClick={() => void refresh()} disabled={refreshing} aria-label={copy.refresh} title={copy.refresh}>
            <RefreshCw className={refreshing ? "kv3-spin" : ""} />
          </button>
          <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("chargeurs:open-kiosk-help"))} aria-label={copy.help} title={copy.help}>
            <HelpCircle />
          </button>
          <div className="kv3-owned-home__language kv5-home-language"><LanguageSwitcher /></div>
        </nav>
      </header>

      <main className="kv3-owned-home__body kv5-home-body">
        <section className="kv3-owned-home__decision kv5-home-decision">
          <div className="kv3-owned-home__heading kv5-home-heading">
            <span>{copy.subtitle}</span>
            <h1>{copy.title}</h1>
          </div>

          <div className="kv3-owned-home__price kv5-home-price" aria-label={[primaryPrice, secondaryPrice, capPrice].filter(Boolean).join(" · ")}>
            <span className="kv3-owned-home__price-icon"><Zap /></span>
            <strong>{primaryPrice}</strong>
            {secondaryPrice && <><i /><span>{secondaryPrice}</span></>}
            {capPrice && <strong>{capPrice}</strong>}
          </div>

          <div className="kv3-owned-home__choices kv5-home-choices">
            <button
              type="button"
              className="kv3-owned-home__choice kv3-owned-home__choice--express kv5-home-choice kv5-home-choice--express"
              disabled={snapshot.expressDisabled || !guestPricing}
              onClick={() => clickUnderlying(".ck2-choice-express")}
            >
              <span className="kv5-home-watermark" aria-hidden="true"><Zap /></span>
              <span className="kv3-owned-home__choice-icon kv5-home-choice-icon"><Zap /></span>
              <span className="kv3-owned-home__choice-kicker kv5-home-choice-kicker">{copy.expressKicker}</span>
              <strong>{copy.expressTitle}</strong>
              <small>{copy.expressBody}</small>
              <b className="kv5-home-choice-arrow" aria-hidden="true">→</b>
            </button>

            <button
              type="button"
              className="kv3-owned-home__choice kv3-owned-home__choice--client kv5-home-choice kv5-home-choice--client"
              disabled={snapshot.clientDisabled}
              onClick={() => clickUnderlying(".ck2-choice-member")}
            >
              <span className="kv3-owned-home__choice-icon kv5-home-choice-icon"><UserRound /></span>
              <span className="kv3-owned-home__choice-kicker kv5-home-choice-kicker">{copy.clientKicker}</span>
              <strong>{copy.clientTitle}</strong>
              <small>{copy.clientBody}</small>
              <b className="kv5-home-choice-arrow" aria-hidden="true">→</b>
            </button>
          </div>
        </section>

        <aside className="kv3-owned-home__station kv5-home-station" aria-label={copy.ready}>
          <div className="kv5-station-aura" aria-hidden="true" />
          <div className="kv5-station-shell">
            <div className="kv5-station-top" aria-hidden="true" />
            <div className="kv5-station-side" aria-hidden="true" />
            <div className="kv5-station-face">
              <div className="kv3-owned-home__station-screen kv5-station-screen">
                <BrandLogo size="sm" />
                <strong>{copy.ready}</strong>
              </div>
              <div className="kv3-owned-home__station-slots kv5-station-slots">
                {[1, 2, 3, 4].map((slot) => (
                  <div key={slot} className="kv5-station-slot">
                    <span>{slot}</span>
                    <i aria-hidden="true" />
                  </div>
                ))}
              </div>
            </div>
            <div className="kv5-station-base" aria-hidden="true" />
            <div className="kv5-station-rim" aria-hidden="true" />
          </div>
          <div className="kv3-owned-home__station-floor kv5-home-floor" aria-hidden="true" />
        </aside>
      </main>

      <footer className="kv3-owned-home__payments kv5-home-payments" aria-label={copy.secure}>
        <span>{copy.secure}</span>
        <KioskPaymentMarks cardLabel="" />
      </footer>
    </section>
  );
}
