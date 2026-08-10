import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { Loader2, UserRound } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import Kiosk from "./Kiosk";
import KioskJourneyGate from "./KioskJourneyGate";
import { readKioskToken } from "@/lib/kioskFetch";
import {
  invokeKioskEdgeProxy,
  KIOSK_JOURNEY_STORAGE_KEY,
  KIOSK_PAIRING_STORAGE_KEY,
} from "@/lib/kioskEdgeProxy";
import "./kiosk-premium-gate.css";
import "./kiosk-da-master.css";

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
};

type Stage = "hero" | "member" | "connected" | "guest" | "legacy";

const money = (cents: number | null | undefined, currency = "CHF") =>
  cents == null ? "—" : `${(cents / 100).toFixed(2)} ${currency}`;

export default function KioskPremiumGate() {
  const { stationId = "" } = useParams();
  const [stage, setStage] = useState<Stage>("hero");
  const [options, setOptions] = useState<CustomerOptions | null>(null);
  const [pairing, setPairing] = useState<PairingCreate | null>(null);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

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
      if (data?.ok && data.active) {
        setStage("legacy");
        setChecking(false);
        return;
      }
      await loadOptions();
      if (!cancelled) setChecking(false);
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
      if (data.connected) {
        try {
          sessionStorage.setItem(KIOSK_JOURNEY_STORAGE_KEY, "member");
          sessionStorage.setItem(KIOSK_PAIRING_STORAGE_KEY, pairing.pairingId!);
        } catch { /* server remains authoritative */ }
        document.documentElement.dataset.kioskJourney = "client";
        setStage("connected");
        window.setTimeout(() => setStage("guest"), 900);
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 900);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [pairing?.pairingId, stage, stationId]);

  if (stage === "legacy") return <KioskJourneyGate />;
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
          <BrandLogo size="md" />
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

  return (
    <div className="premium-kiosk da-master-screen da-home">
      <div className="da-ambient da-ambient-left" aria-hidden="true" />
      <div className="da-ambient da-ambient-right" aria-hidden="true" />
      <div className="da-smoke da-smoke-a" aria-hidden="true" />
      <div className="da-smoke da-smoke-b" aria-hidden="true" />
      <header className="da-topbar">
        <BrandLogo size="md" />
        <nav className="da-nav">
          <button type="button" onClick={() => window.location.reload()}>↻ Actualiser</button>
          <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("chargeurs:open-kiosk-help"))}>? FAQ / Aide</button>
          <LanguageSwitcher />
        </nav>
      </header>

      <main className="da-home-grid">
        <section className="da-copy-column">
          <div className="da-hero-title">
            <span>PLUS DE</span>
            <span>BATTERIE ?</span>
            <strong>RÉGLÉ.</strong>
          </div>
          <div className="da-price-strip">
            <span className="da-price-dot">⚡</span>
            <strong>{money(options?.guest?.hourly_cents, options?.guest?.currency)}</strong>
            <span>/ heure</span>
            {options?.guest?.daily_cap_cents ? <><i>•</i><span>Plafond journalier</span><strong>{money(options.guest.daily_cap_cents, options.guest.currency)}</strong></> : null}
          </div>

          <div className="da-choice-row">
            <button className="da-choice da-choice-express" onClick={chooseGuest} disabled={!options?.guest}>
              <span className="da-choice-icon">⚡</span>
              <span className="da-choice-kicker">LOCATION</span>
              <strong>EXPRESS</strong>
              <small>Sans compte.<br/>Payez sur votre téléphone et partez.</small>
              <span className="da-choice-arrow">→</span>
            </button>

            <button className="da-choice da-choice-client" onClick={() => void startMember()} disabled={!options?.memberAvailable}>
              <span className="da-choice-icon">◉</span>
              <span className="da-choice-kicker">CLIENT</span>
              <strong>CHARGEURS</strong>
              <small>Connectez-vous par QR.<br/>Profitez de vos avantages.</small>
              <span className="da-choice-arrow">→</span>
            </button>
          </div>
        </section>

        <section className="da-scene" aria-label="Borne Chargeurs.ch">
          <div className="da-lightning" aria-hidden="true">ϟ</div>
          <div className="da-cabinet">
            <div className="da-cabinet-screen">
              <BrandLogo size="sm" />
              <div><strong>Bienvenue</strong><span>Choisissez votre option</span></div>
            </div>
            <div className="da-cabinet-body">
              <BrandLogo size="sm" />
              <div className="da-slots">
                {[1,2,3,4].map((slot) => <span key={slot}><i>{slot}</i><b /></span>)}
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
