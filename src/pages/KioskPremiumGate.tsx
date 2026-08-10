import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { Info, Loader2, QrCode, ShieldCheck, UserRound } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { KioskPaymentMarks } from "@/components/kiosk/KioskPaymentMarks";
import Kiosk from "./Kiosk";
import KioskJourneyGate from "./KioskJourneyGate";
import { readKioskToken } from "@/lib/kioskFetch";
import {
  invokeKioskEdgeProxy,
  KIOSK_JOURNEY_STORAGE_KEY,
  KIOSK_PAIRING_STORAGE_KEY,
} from "@/lib/kioskEdgeProxy";
import "./kiosk-premium-gate.css";

type SegmentPrice = {
  segment: "guest" | "member";
  currency: string;
  hourly_cents: number | null;
  daily_cap_cents: number;
  deposit_cents?: number | null;
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
    return () => document.documentElement.classList.remove("kiosk-mode");
  }, []);

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
    setStage("guest");
  };

  const startMember = async () => {
    const token = readKioskToken();
    if (!token || !stationId || !options?.memberAvailable) return;
    setPairingError(null);
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
    return (
      <div className="premium-kiosk premium-kiosk-loading">
        <Loader2 className="h-14 w-14 animate-spin" />
      </div>
    );
  }

  if (stage === "connected") {
    return (
      <div className="premium-kiosk premium-connected">
        <div className="premium-connected-ring"><UserRound /></div>
        <h1>Compte connecté</h1>
        <p>Votre tarif client est activé.</p>
      </div>
    );
  }

  if (stage === "member") {
    const connectUrl = pairing?.connectPath ? `${window.location.origin}${pairing.connectPath}` : null;
    return (
      <div className="premium-kiosk premium-member-screen">
        <div className="premium-member-panel">
          <BrandLogo size="md" />
          <div className="premium-member-copy">
            <span>CLIENT CHARGEURS</span>
            <h1>Connectez votre compte</h1>
            <p>Scannez ce QR avec l’appareil photo de votre téléphone. Aucune donnée personnelle n’est saisie sur la borne.</p>
            <strong>{money(options?.member?.hourly_cents, options?.member?.currency)} / h</strong>
          </div>
          <button onClick={() => { setPairing(null); setStage("hero"); }}>Retour</button>
        </div>
        <div className="premium-member-qr">
          {connectUrl && !pairingError ? (
            <QRCodeSVG value={connectUrl} size={360} level="M" marginSize={2} />
          ) : pairingError ? (
            <div className="premium-member-error">Connexion temporairement indisponible</div>
          ) : (
            <Loader2 className="h-14 w-14 animate-spin" />
          )}
        </div>
      </div>
    );
  }

  const guestCap = money(options?.guest?.daily_cap_cents, options?.guest?.currency);
  const deposit = money(options?.guest?.deposit_cents ?? 3000, options?.guest?.currency ?? "CHF");

  return (
    <div className="premium-kiosk premium-hero premium-hero-confirmed">
      <div className="premium-hero-art" aria-hidden="true" />
      <button className="premium-hotspot premium-hotspot-refresh" type="button" aria-label="Actualiser" onClick={() => window.location.reload()} />
      <button className="premium-hotspot premium-hotspot-help" type="button" aria-label="FAQ / Aide" onClick={() => window.dispatchEvent(new CustomEvent("chargeurs:open-kiosk-help"))} />
      <div className="premium-language-overlay" aria-label="Langues"><LanguageSwitcher /></div>
      <button className="premium-hotspot premium-hotspot-express" type="button" aria-label="Location express" onClick={chooseGuest} disabled={!options?.guest} />
      <button className="premium-hotspot premium-hotspot-member" type="button" aria-label="Client Chargeurs" onClick={() => void startMember()} disabled={!options?.memberAvailable} />

      <footer className="premium-payment-strip">
        <div className="premium-payment-secure"><ShieldCheck /><span>Paiement sécurisé<br />par <b>Stripe</b></span></div>
        <div className="premium-payment-methods"><span className="premium-payment-label">PAYEZ AVEC</span><KioskPaymentMarks cardLabel="Carte" /></div>
        <div className="premium-payment-guide"><QrCode /><span>Scannez avec l’appareil photo<br />puis choisissez votre moyen de paiement</span></div>
        <div className="premium-payment-limits"><span><Info />Plafond journalier <b>{guestCap}</b></span><span><ShieldCheck />Caution <b>{deposit}</b></span></div>
      </footer>
    </div>
  );
}
