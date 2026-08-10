import { useCallback, useEffect, useState } from "react";
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
import cinematicArtwork from "./chargeurs-cinematic-home.b64?raw";
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

const cinematicArtworkSrc = `data:image/jpeg;base64,${cinematicArtwork.trim()}`;

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
    <main className="cinematic-home" data-kiosk-cinematic-home="true">
      <img className="cinematic-home__art" src={cinematicArtworkSrc} alt="" aria-hidden="true" />

      <div className="cinematic-home__price-mask" aria-label={`Tarif ${guestHourly} par heure, plafond journalier ${guestCap}`}>
        <div className="cinematic-home__price">
          <span className="cinematic-home__bolt-icon">⚡</span>
          <strong>{guestHourly}</strong>
          <span>/ heure</span>
          <span className="cinematic-home__sep">•</span>
          <span className="cinematic-home__cap-label">Plafond journalier</span>
          <strong>{guestCap}</strong>
        </div>
      </div>

      <button
        type="button"
        className="cinematic-home__hit cinematic-home__refresh"
        aria-label="Actualiser"
        onClick={() => window.location.reload()}
      >
        <span className="cinematic-home__sr">Actualiser</span>
      </button>

      <button
        type="button"
        className="cinematic-home__hit cinematic-home__help"
        aria-label="Aide"
        onClick={() => window.dispatchEvent(new CustomEvent("chargeurs:open-kiosk-help"))}
      >
        <span className="cinematic-home__sr">Aide</span>
      </button>

      <div className="cinematic-home__language" aria-label="Langues">
        <LanguageSwitcher />
      </div>

      <button
        type="button"
        className="cinematic-home__hit cinematic-home__express"
        aria-label="Location Express"
        disabled={!options?.guest}
        onClick={chooseGuest}
      >
        <span className="cinematic-home__sr">Location Express</span>
      </button>

      <button
        type="button"
        className="cinematic-home__hit cinematic-home__client"
        aria-label="Client Chargeurs"
        disabled={!options?.memberAvailable}
        onClick={() => void startMember()}
      >
        <span className="cinematic-home__sr">Client Chargeurs</span>
      </button>
    </main>
  );
}
