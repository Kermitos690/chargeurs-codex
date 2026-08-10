import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { Loader2, UserRound } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import Kiosk from "./Kiosk";
import { readKioskToken } from "@/lib/kioskFetch";
import {
  invokeKioskEdgeProxy,
  KIOSK_JOURNEY_STORAGE_KEY,
  KIOSK_PAIRING_STORAGE_KEY,
} from "@/lib/kioskEdgeProxy";
import "./kiosk-premium-gate.css";
import "./kiosk-da-master.css";
import "./kiosk-cinematic-home.css";

type SegmentPrice = {
  segment: "guest" | "member";
  currency: string;
  hourly_cents: number | null;
  daily_cap_cents: number;
};

type CustomerOptions = {
  ok?: boolean;
  guest?: SegmentPrice;
  member?: SegmentPrice | null;
  memberAvailable?: boolean;
};

type PairingCreate = {
  ok?: boolean;
  pairingId?: string;
  connectPath?: string;
  expiresAt?: string;
  error?: string;
};

type PairingStatus = {
  ok?: boolean;
  state?: string;
  connected?: boolean;
};

type ResumeResponse = {
  ok?: boolean;
  active?: boolean;
  state?: string | null;
  kioskActionRequired?: boolean;
};

type Stage = "hero" | "member" | "connected" | "guest";

const money = (cents: number | null | undefined, currency = "CHF") =>
  cents == null ? "—" : `${(cents / 100).toFixed(2)} ${currency}`;

const KIOSK_RESUMABLE_STATES = new Set([
  "created",
  "checkout_created",
  "payment_pending",
  "payment_succeeded",
  "ejecting",
]);

export default function KioskPremiumGate() {
  const { stationId = "" } = useParams();
  const [stage, setStage] = useState<Stage>("hero");
  const [options, setOptions] = useState<CustomerOptions | null>(null);
  const [pairing, setPairing] = useState<PairingCreate | null>(null);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const pairingSeenPending = useRef(false);

  const loadOptions = useCallback(async () => {
    const token = readKioskToken();
    if (!token || !stationId) return;
    const { data } = await invokeKioskEdgeProxy<CustomerOptions>(
      "/api/kiosk/customer-options",
      { stationId },
      { "X-Kiosk-Token": token },
    );
    if (data?.ok) setOptions(data);
  }, [stationId]);

  useEffect(() => {
    document.documentElement.classList.add("kiosk-mode");
    return () => {
      document.documentElement.classList.remove("kiosk-mode");
      delete document.documentElement.dataset.kioskJourney;
    };
  }, []);

  useEffect(() => {
    if (stage === "hero") delete document.documentElement.dataset.kioskJourney;
    if (stage === "member" || stage === "connected") document.documentElement.dataset.kioskJourney = "client";
  }, [stage]);

  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      const token = readKioskToken();
      if (!token || !stationId) {
        setChecking(false);
        return;
      }

      const { data } = await invokeKioskEdgeProxy<ResumeResponse>(
        "/api/kiosk/resume-state",
        { stationId },
        { "X-Kiosk-Token": token },
      );
      if (cancelled) return;

      const state = data?.state ?? null;
      const mustResumeOnKiosk = Boolean(
        data?.ok &&
        data.active &&
        (data.kioskActionRequired === true || (state && KIOSK_RESUMABLE_STATES.has(state)))
      );

      if (mustResumeOnKiosk) {
        try {
          const journey = sessionStorage.getItem(KIOSK_JOURNEY_STORAGE_KEY);
          if (journey === "member") document.documentElement.dataset.kioskJourney = "client";
          if (journey === "guest") document.documentElement.dataset.kioskJourney = "express";
        } catch { /* noop */ }
        setStage("guest");
        setChecking(false);
        return;
      }

      try {
        sessionStorage.removeItem(KIOSK_JOURNEY_STORAGE_KEY);
        sessionStorage.removeItem(KIOSK_PAIRING_STORAGE_KEY);
      } catch { /* noop */ }
      delete document.documentElement.dataset.kioskJourney;
      await loadOptions();
      if (!cancelled) {
        setStage("hero");
        setChecking(false);
      }
    };
    void boot();
    return () => { cancelled = true; };
  }, [loadOptions, stationId]);

  useEffect(() => {
    try {
      const native = window as Window & { ChargeursNative?: { kioskUiReady?: () => void } };
      native.ChargeursNative?.kioskUiReady?.();
    } catch {
      // Browser preview has no native bridge.
    }
  }, [checking, stage]);

  const chooseGuest = () => {
    try {
      sessionStorage.setItem(KIOSK_JOURNEY_STORAGE_KEY, "guest");
      sessionStorage.removeItem(KIOSK_PAIRING_STORAGE_KEY);
    } catch { /* noop */ }
    document.documentElement.dataset.kioskJourney = "express";
    setStage("guest");
  };

  const startMember = async () => {
    const token = readKioskToken();
    if (!token || !stationId || !options?.memberAvailable) return;
    setPairingError(null);
    setPairing(null);
    pairingSeenPending.current = false;
    document.documentElement.dataset.kioskJourney = "client";
    setStage("member");
    const { data, transportError } = await invokeKioskEdgeProxy<PairingCreate>(
      "/api/kiosk/customer-pairing-create",
      { stationId },
      { "X-Kiosk-Token": token },
    );
    if (transportError || !data?.ok || !data.pairingId || !data.connectPath || !data.expiresAt) {
      setPairingError(data?.error ?? "PAIRING_CREATE_FAILED");
      return;
    }
    setPairing(data);
  };

  useEffect(() => {
    if (stage !== "member" || !pairing?.pairingId) return;
    const token = readKioskToken();
    if (!token) return;
    let cancelled = false;
    const poll = async () => {
      const { data } = await invokeKioskEdgeProxy<PairingStatus>(
        "/api/kiosk/customer-pairing-status",
        { stationId, pairingId: pairing.pairingId },
        { "X-Kiosk-Token": token },
      );
      if (cancelled || !data?.ok) return;
      if (data.state === "expired") {
        setPairingError("PAIRING_EXPIRED");
        return;
      }
      if (!data.connected) {
        pairingSeenPending.current = true;
        return;
      }
      if (!pairingSeenPending.current) return;

      try {
        sessionStorage.setItem(KIOSK_JOURNEY_STORAGE_KEY, "member");
        sessionStorage.setItem(KIOSK_PAIRING_STORAGE_KEY, pairing.pairingId!);
      } catch { /* server remains authoritative */ }
      document.documentElement.dataset.kioskJourney = "client";
      setStage("connected");
      window.setTimeout(() => setStage("guest"), 1800);
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 900);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [pairing?.pairingId, stage, stationId]);

  if (stage === "guest") return <Kiosk />;

  if (checking) {
    return <div className="premium-kiosk da-master-screen da-loading"><Loader2 className="h-14 w-14 animate-spin" /></div>;
  }

  if (stage === "connected") {
    return (
      <div className="premium-kiosk da-master-screen da-client-screen da-connected">
        <div className="da-connected-ring"><UserRound /></div>
        <h1>Compte connecté</h1>
        <p>Votre tarif client est activé.</p>
      </div>
    );
  }

  if (stage === "member") {
    const connectUrl = pairing?.connectPath ? `${window.location.origin}${pairing.connectPath}` : null;
    return (
      <div className="premium-kiosk da-master-screen da-client-screen">
        <header className="da-topbar">
          <div className="da-brand"><BrandLogo size="md" /></div>
          <button className="da-top-action" onClick={() => { setPairing(null); setStage("hero"); }}>← Annuler</button>
        </header>
        <div className="da-member-layout">
          <section className="da-member-copy">
            <span className="da-eyebrow da-blue">CLIENT CHARGEURS</span>
            <h1>Scannez ce QR avec<br/><strong>votre téléphone</strong></h1>
            <p>Aucune donnée personnelle n’est saisie sur cette borne. La connexion est temporaire et sera fermée automatiquement.</p>
            <div className="da-live-price da-blue">{money(options?.member?.hourly_cents, options?.member?.currency)} <small>/ h</small></div>
          </section>
          <section className="da-qr-panel">
            {connectUrl && !pairingError ? (
              <QRCodeSVG value={connectUrl} size={360} level="M" bgColor="#ffffff" fgColor="#000000" marginSize={2} />
            ) : pairingError ? (
              <div className="premium-member-error">Connexion temporairement indisponible</div>
            ) : (
              <Loader2 className="h-14 w-14 animate-spin" />
            )}
            <p>Ouvrez l’appareil photo de votre téléphone et scannez le code.</p>
          </section>
        </div>
      </div>
    );
  }

  const guestCurrency = options?.guest?.currency ?? "CHF";
  const guestHourly = money(options?.guest?.hourly_cents, guestCurrency);
  const guestCap = money(options?.guest?.daily_cap_cents, guestCurrency);

  return (
    <main className="cinematic-home" data-kiosk-cinematic-home="native-v1">
      <div className="cinematic-home__bg" aria-hidden="true" />
      <div className="cinematic-home__aurora cinematic-home__aurora--a" aria-hidden="true" />
      <div className="cinematic-home__aurora cinematic-home__aurora--b" aria-hidden="true" />
      <div className="cinematic-home__aurora cinematic-home__aurora--c" aria-hidden="true" />
      <div className="cinematic-home__smoke cinematic-home__smoke--a" aria-hidden="true" />
      <div className="cinematic-home__smoke cinematic-home__smoke--b" aria-hidden="true" />
      <div className="cinematic-home__floor" aria-hidden="true" />

      <header className="cinematic-home__topbar">
        <div className="cinematic-home__brand"><BrandLogo size="md" /></div>
        <nav className="cinematic-home__nav">
          <button type="button" onClick={() => window.location.reload()}>↻ Actualiser</button>
          <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("chargeurs:open-kiosk-help"))}>? Aide</button>
          <div className="cinematic-home__language"><LanguageSwitcher /></div>
        </nav>
      </header>

      <section className="cinematic-home__content">
        <div className="cinematic-home__eyebrow">POWER WHEN YOU NEED IT</div>
        <h1 className="cinematic-home__headline">
          <span>PLUS DE</span>
          <span>BATTERIE ?</span>
          <strong>RÉGLÉ.</strong>
        </h1>

        <div className="cinematic-home__price">
          <span className="cinematic-home__price-bolt">⚡</span>
          <strong>{guestHourly}</strong>
          <span className="muted">/ heure</span>
          <span className="sep">•</span>
          <span className="muted">Plafond journalier</span>
          <strong>{guestCap}</strong>
        </div>

        <div className="cinematic-home__choices">
          <button className="cinematic-home__choice cinematic-home__choice--express" onClick={chooseGuest} disabled={!options?.guest}>
            <span className="cinematic-home__choice-icon">⚡</span>
            <span className="cinematic-home__choice-kicker">LOCATION</span>
            <strong>EXPRESS</strong>
            <small>Sans compte.<br/>Payez sur votre téléphone et partez.</small>
            <span className="cinematic-home__choice-arrow">→</span>
          </button>

          <button className="cinematic-home__choice cinematic-home__choice--client" onClick={() => void startMember()} disabled={!options?.memberAvailable}>
            <span className="cinematic-home__choice-icon">◉</span>
            <span className="cinematic-home__choice-kicker">CLIENT</span>
            <strong>CHARGEURS</strong>
            <small>Connectez-vous par QR.<br/>Profitez de vos avantages.</small>
            <span className="cinematic-home__choice-arrow">→</span>
          </button>
        </div>
      </section>

      <section className="cinematic-home__scene" aria-label="Borne Chargeurs.ch">
        <div className="cinematic-home__bolt" aria-hidden="true">
          <svg viewBox="0 0 180 420" role="presentation">
            <defs>
              <linearGradient id="boltFill" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#f9fcff" />
                <stop offset="32%" stopColor="#83c9ff" />
                <stop offset="66%" stopColor="#646cff" />
                <stop offset="100%" stopColor="#9a5cff" />
              </linearGradient>
            </defs>
            <path className="cinematic-home__bolt-core" d="M106 4 26 206h63L61 416l94-247H92z" />
            <path className="cinematic-home__bolt-glint" d="M104 25 50 189h47M87 215 69 350" />
          </svg>
        </div>

        <div className="cinematic-home__cabinet-wrap">
          <div className="cinematic-home__cabinet">
            <div className="cinematic-home__cabinet-screen">
              <BrandLogo size="sm" />
              <strong>Bienvenue</strong>
              <span>Choisissez votre option</span>
            </div>
            <div className="cinematic-home__cabinet-logo"><BrandLogo size="sm" /></div>
            <div className="cinematic-home__slots">
              {[1, 2, 3, 4].map((slot) => <div className="cinematic-home__slot" key={slot}><i>{slot}</i></div>)}
            </div>
          </div>
          <div className="cinematic-home__cabinet-reflection" aria-hidden="true" />
        </div>

        <div className="cinematic-home__plants" aria-hidden="true">
          {[1, 2, 3, 4, 5].map((leaf) => <span className="cinematic-home__leaf" key={leaf} />)}
        </div>
      </section>

      <div className="cinematic-home__vignette" aria-hidden="true" />
    </main>
  );
}
