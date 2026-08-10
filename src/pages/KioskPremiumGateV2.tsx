import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import {
  CheckCircle2,
  Clock3,
  HelpCircle,
  Loader2,
  RefreshCw,
  ShieldCheck,
  UserRound,
  WalletCards,
  X,
  Zap,
} from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useI18n } from "@/i18n/i18n";
import Kiosk from "./Kiosk";
import { readKioskToken } from "@/lib/kioskFetch";
import {
  invokeKioskEdgeProxy,
  KIOSK_JOURNEY_STORAGE_KEY,
  KIOSK_PAIRING_STORAGE_KEY,
} from "@/lib/kioskEdgeProxy";
import "./kiosk-premium-v2.css";

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

type MemberSummary = {
  planCode?: string;
  planName?: string;
  currency?: string;
  hourlyCents?: number | null;
  dailyCapCents?: number | null;
  includedMinutes?: number | null;
  renewalCreditCents?: number | null;
  renewsAt?: string | null;
  walletPassActive?: boolean;
  walletProviderStatus?: string;
};

type PairingStatus = {
  ok?: boolean;
  state?: string;
  connected?: boolean;
  displayName?: string;
  preferredLanguage?: string | null;
  segment?: string;
  member?: MemberSummary | null;
};

type ResumeResponse = {
  ok?: boolean;
  active?: boolean;
  state?: string | null;
  kioskActionRequired?: boolean;
};

type Stage = "hero" | "member" | "connected" | "guest";

type Copy = {
  refresh: string;
  help: string;
  cancel: string;
  returnHome: string;
  connectedKicker: string;
  connectedTitle: string;
  connectedSubtitle: string;
  connectedBenefits: string;
  connectedRate: string;
  connectedCap: string;
  connectedMinutes: string;
  connectedWallet: string;
  connectedWalletLocal: string;
  connectedCta: string;
  connectedCtaSub: string;
  memberEyebrow: string;
  memberTitle: string;
  memberTitleAccent: string;
  memberPrivacy: string;
  memberRateLabel: string;
  memberScan: string;
  memberError: string;
  retry: string;
  eyebrow: string;
  line1: string;
  line2: string;
  accent: string;
  perHour: string;
  dailyCap: string;
  expressKicker: string;
  expressTitle: string;
  expressBody: string;
  clientKicker: string;
  clientTitle: string;
  clientBody: string;
  cabinetTitle: string;
  cabinetSub: string;
  secure: string;
};

const COPY: Record<"fr" | "en" | "de", Copy> = {
  fr: {
    refresh: "Actualiser", help: "Aide", cancel: "Annuler", returnHome: "Retour accueil",
    connectedKicker: "PASS RECONNU", connectedTitle: "CONNEXION RÉUSSIE", connectedSubtitle: "Vos avantages Client Chargeurs actifs sont chargés depuis votre compte.",
    connectedBenefits: "Vos avantages actifs", connectedRate: "Tarif membre", connectedCap: "Plafond journalier", connectedMinutes: "Minutes incluses", connectedWallet: "Pass Wallet", connectedWalletLocal: "Pass compte actif",
    connectedCta: "COMMENCER UNE LOCATION", connectedCtaSub: "Choisissez ensuite votre batterie sur cette borne.",
    memberEyebrow: "CLIENT CHARGEURS", memberTitle: "Scannez avec", memberTitleAccent: "votre téléphone", memberPrivacy: "Connexion temporaire et sécurisée. Aucune donnée personnelle n’est saisie sur la borne.",
    memberRateLabel: "Tarif Client Chargeurs", memberScan: "Ouvrez l’appareil photo de votre téléphone et scannez le QR code.", memberError: "Connexion temporairement indisponible", retry: "Réessayer",
    eyebrow: "POWER WHEN YOU NEED IT", line1: "PLUS DE", line2: "BATTERIE ?", accent: "RÉGLÉ.", perHour: "/ heure", dailyCap: "Plafond journalier",
    expressKicker: "LOCATION", expressTitle: "EXPRESS", expressBody: "Sans compte. Choisissez une batterie, payez sur votre téléphone et partez.",
    clientKicker: "CLIENT", clientTitle: "CHARGEURS", clientBody: "Scannez le QR. L’adhésion active est vérifiée côté serveur avant d’appliquer le tarif membre.",
    cabinetTitle: "Batteries disponibles", cabinetSub: "Sélection automatique de la meilleure batterie", secure: "Connexion sécurisée",
  },
  en: {
    refresh: "Refresh", help: "Help", cancel: "Cancel", returnHome: "Back home",
    connectedKicker: "PASS RECOGNISED", connectedTitle: "CONNECTION SUCCESSFUL", connectedSubtitle: "Your active Chargeurs member benefits are loaded from your account.",
    connectedBenefits: "Your active benefits", connectedRate: "Member rate", connectedCap: "Daily cap", connectedMinutes: "Included minutes", connectedWallet: "Wallet Pass", connectedWalletLocal: "Account Pass active",
    connectedCta: "START A RENTAL", connectedCtaSub: "Choose your powerbank next on this kiosk.",
    memberEyebrow: "CHARGEURS MEMBER", memberTitle: "Scan with", memberTitleAccent: "your phone", memberPrivacy: "Temporary, secure connection. No personal data is entered on the station.",
    memberRateLabel: "Chargeurs member rate", memberScan: "Open your phone camera and scan the QR code.", memberError: "Connection temporarily unavailable", retry: "Try again",
    eyebrow: "POWER WHEN YOU NEED IT", line1: "OUT OF", line2: "BATTERY?", accent: "SOLVED.", perHour: "/ hour", dailyCap: "Daily cap",
    expressKicker: "RENTAL", expressTitle: "EXPRESS", expressBody: "No account. Choose a powerbank, pay on your phone and go.",
    clientKicker: "CHARGEURS", clientTitle: "MEMBER", clientBody: "Scan the QR. An active membership is verified server-side before member pricing is applied.",
    cabinetTitle: "Batteries available", cabinetSub: "Best battery selected automatically", secure: "Secure connection",
  },
  de: {
    refresh: "Aktualisieren", help: "Hilfe", cancel: "Abbrechen", returnHome: "Zur Startseite",
    connectedKicker: "PASS ERKANNT", connectedTitle: "VERBINDUNG ERFOLGREICH", connectedSubtitle: "Ihre aktiven Chargeurs-Kundenvorteile werden aus Ihrem Konto geladen.",
    connectedBenefits: "Ihre aktiven Vorteile", connectedRate: "Kundentarif", connectedCap: "Tageslimit", connectedMinutes: "Inklusive Minuten", connectedWallet: "Wallet Pass", connectedWalletLocal: "Konto-Pass aktiv",
    connectedCta: "MIETE STARTEN", connectedCtaSub: "Wählen Sie anschließend Ihre Powerbank an dieser Station.",
    memberEyebrow: "CHARGEURS KUNDE", memberTitle: "Scanne mit", memberTitleAccent: "deinem Smartphone", memberPrivacy: "Temporäre, sichere Verbindung. Auf der Station werden keine persönlichen Daten eingegeben.",
    memberRateLabel: "Chargeurs-Kundentarif", memberScan: "Öffne die Kamera deines Smartphones und scanne den QR-Code.", memberError: "Verbindung vorübergehend nicht verfügbar", retry: "Erneut versuchen",
    eyebrow: "POWER WHEN YOU NEED IT", line1: "AKKU", line2: "LEER?", accent: "GELÖST.", perHour: "/ Stunde", dailyCap: "Tageslimit",
    expressKicker: "MIETE", expressTitle: "EXPRESS", expressBody: "Ohne Konto. Powerbank wählen, am Smartphone bezahlen und los.",
    clientKicker: "CHARGEURS", clientTitle: "KUNDE", clientBody: "QR scannen. Eine aktive Mitgliedschaft wird serverseitig geprüft, bevor der Kundentarif gilt.",
    cabinetTitle: "Verfügbare Batterien", cabinetSub: "Beste Batterie wird automatisch gewählt", secure: "Sichere Verbindung",
  },
};

const KIOSK_RESUMABLE_STATES = new Set(["created", "checkout_created", "payment_pending", "payment_succeeded", "ejecting"]);
const money = (cents: number | null | undefined, currency = "CHF") => cents == null ? "—" : `${(Number(cents) / 100).toFixed(2)} ${currency}`;

export default function KioskPremiumGateV2() {
  const { stationId = "" } = useParams();
  const { lang } = useI18n();
  const copy = COPY[lang];
  const [stage, setStage] = useState<Stage>("hero");
  const [options, setOptions] = useState<CustomerOptions | null>(null);
  const [pairing, setPairing] = useState<PairingCreate | null>(null);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [connectedInfo, setConnectedInfo] = useState<PairingStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [seconds, setSeconds] = useState(35);
  const [journeyProtected, setJourneyProtected] = useState(false);

  const loadOptions = useCallback(async () => {
    const token = readKioskToken();
    if (!token || !stationId) return;
    const { data } = await invokeKioskEdgeProxy<CustomerOptions>("/api/kiosk/customer-options", { stationId }, { "X-Kiosk-Token": token });
    if (data?.ok) setOptions(data);
  }, [stationId]);

  const refreshOptions = useCallback(async () => {
    setRefreshing(true);
    try { await loadOptions(); } finally { setRefreshing(false); }
  }, [loadOptions]);

  const returnHome = useCallback(() => {
    if (document.querySelector(".kiosk-release-stage")) return;
    try {
      sessionStorage.removeItem(KIOSK_JOURNEY_STORAGE_KEY);
      sessionStorage.removeItem(KIOSK_PAIRING_STORAGE_KEY);
    } catch { /* noop */ }
    delete document.documentElement.dataset.kioskJourney;
    setPairing(null);
    setPairingError(null);
    setConnectedInfo(null);
    setSeconds(35);
    setStage("hero");
    void loadOptions();
  }, [loadOptions]);

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
      if (!token || !stationId) { setChecking(false); return; }
      const { data } = await invokeKioskEdgeProxy<ResumeResponse>("/api/kiosk/resume-state", { stationId }, { "X-Kiosk-Token": token });
      if (cancelled) return;
      const state = data?.state ?? null;
      const mustResume = Boolean(data?.ok && data.active && (data.kioskActionRequired === true || (state && KIOSK_RESUMABLE_STATES.has(state))));
      if (mustResume) {
        try {
          const journey = sessionStorage.getItem(KIOSK_JOURNEY_STORAGE_KEY);
          if (journey === "member") document.documentElement.dataset.kioskJourney = "client";
          if (journey === "guest") document.documentElement.dataset.kioskJourney = "express";
        } catch { /* noop */ }
        setStage("guest"); setChecking(false); return;
      }
      try {
        sessionStorage.removeItem(KIOSK_JOURNEY_STORAGE_KEY);
        sessionStorage.removeItem(KIOSK_PAIRING_STORAGE_KEY);
      } catch { /* noop */ }
      delete document.documentElement.dataset.kioskJourney;
      await loadOptions();
      if (!cancelled) { setStage("hero"); setChecking(false); }
    };
    void boot();
    return () => { cancelled = true; };
  }, [loadOptions, stationId]);

  useEffect(() => {
    try {
      const native = window as Window & { ChargeursNative?: { kioskUiReady?: () => void } };
      native.ChargeursNative?.kioskUiReady?.();
    } catch { /* browser preview */ }
  }, [checking, stage]);

  useEffect(() => {
    if (stage !== "guest") { setJourneyProtected(false); return; }
    const inspect = () => setJourneyProtected(Boolean(document.querySelector(".kiosk-release-stage")));
    inspect();
    const observer = new MutationObserver(inspect);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [stage]);

  const timerActive = !checking && stage !== "hero" && !journeyProtected;
  useEffect(() => {
    if (!timerActive) { setSeconds(35); return; }
    setSeconds(35);
    const activity = () => setSeconds(35);
    const interval = window.setInterval(() => setSeconds((value) => Math.max(0, value - 1)), 1000);
    window.addEventListener("pointerdown", activity, { passive: true });
    window.addEventListener("keydown", activity);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("pointerdown", activity);
      window.removeEventListener("keydown", activity);
    };
  }, [timerActive, stage]);

  useEffect(() => { if (timerActive && seconds === 0) returnHome(); }, [seconds, timerActive, returnHome]);

  const chooseGuest = () => {
    try {
      sessionStorage.setItem(KIOSK_JOURNEY_STORAGE_KEY, "guest");
      sessionStorage.removeItem(KIOSK_PAIRING_STORAGE_KEY);
    } catch { /* noop */ }
    document.documentElement.dataset.kioskJourney = "express";
    setSeconds(35);
    setStage("guest");
  };

  const startMember = async () => {
    const token = readKioskToken();
    if (!token || !stationId || !options?.memberAvailable) return;
    setPairingError(null);
    setPairing(null);
    setConnectedInfo(null);
    document.documentElement.dataset.kioskJourney = "client";
    setSeconds(35);
    setStage("member");
    const { data, transportError } = await invokeKioskEdgeProxy<PairingCreate>("/api/kiosk/customer-pairing-create", { stationId }, { "X-Kiosk-Token": token });
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
      const { data } = await invokeKioskEdgeProxy<PairingStatus>("/api/kiosk/customer-pairing-status", { stationId, pairingId: pairing.pairingId }, { "X-Kiosk-Token": token });
      if (cancelled || !data?.ok) return;
      if (data.state === "expired") { setPairingError("PAIRING_EXPIRED"); return; }
      if (!data.connected) return;
      try {
        sessionStorage.setItem(KIOSK_JOURNEY_STORAGE_KEY, "member");
        sessionStorage.setItem(KIOSK_PAIRING_STORAGE_KEY, pairing.pairingId!);
      } catch { /* server remains authoritative */ }
      document.documentElement.dataset.kioskJourney = "client";
      setConnectedInfo(data);
      setStage("connected");
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 900);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [pairing?.pairingId, stage, stationId]);

  const continueMember = () => {
    if (!pairing?.pairingId || !connectedInfo?.connected) return;
    try {
      sessionStorage.setItem(KIOSK_JOURNEY_STORAGE_KEY, "member");
      sessionStorage.setItem(KIOSK_PAIRING_STORAGE_KEY, pairing.pairingId);
    } catch { /* server remains authoritative */ }
    document.documentElement.dataset.kioskJourney = "client";
    setSeconds(35);
    setStage("guest");
  };

  const journeyControl = timerActive ? (
    <div className="ck2-journey-control" role="status" aria-live="polite">
      <Clock3 aria-hidden="true" /><span>{copy.returnHome}</span><strong>{seconds}s</strong>
      <button type="button" onClick={returnHome} aria-label={copy.cancel}><X aria-hidden="true" /> {copy.cancel}</button>
    </div>
  ) : null;

  if (checking) return <div className="ck2-shell ck2-loading"><Loader2 className="ck2-spin" /></div>;

  if (stage === "guest") return <><Kiosk />{journeyControl}</>;

  if (stage === "connected") {
    const member = connectedInfo?.member;
    const currency = member?.currency ?? options?.member?.currency ?? "CHF";
    const hourly = member?.hourlyCents ?? options?.member?.hourly_cents;
    const dailyCapValue = member?.dailyCapCents ?? options?.member?.daily_cap_cents;
    return (
      <div className="ck2-shell ck2-connected">
        {journeyControl}
        <header className="ck2-topbar ck2-connected-topbar">
          <BrandLogo size="md" />
          <button type="button" className="ck2-pill" onClick={returnHome}><X /> {copy.returnHome}</button>
        </header>
        <main className="ck2-connected-grid">
          <section className="ck2-connected-copy">
            <div className="ck2-connected-check"><CheckCircle2 /></div>
            <span className="ck2-eyebrow">{copy.connectedKicker}</span>
            <h1>{copy.connectedTitle}</h1>
            <p>{connectedInfo?.displayName ? `${connectedInfo.displayName}, ${copy.connectedSubtitle.charAt(0).toLowerCase()}${copy.connectedSubtitle.slice(1)}` : copy.connectedSubtitle}</p>
            {member?.planName && <strong className="ck2-connected-plan">{member.planName}</strong>}
          </section>

          <section className="ck2-connected-benefits">
            <h2>{copy.connectedBenefits}</h2>
            <div className="ck2-connected-benefit-grid">
              <article><Zap /><span>{copy.connectedRate}</span><strong>{money(hourly, currency)} {copy.perHour}</strong></article>
              <article><Clock3 /><span>{copy.connectedCap}</span><strong>{money(dailyCapValue, currency)}</strong></article>
              {Number(member?.includedMinutes ?? 0) > 0 && <article><Clock3 /><span>{copy.connectedMinutes}</span><strong>{member?.includedMinutes} min</strong></article>}
              {member?.walletPassActive && <article><WalletCards /><span>{copy.connectedWallet}</span><strong>{member.walletProviderStatus === "issued" ? copy.connectedWallet : copy.connectedWalletLocal}</strong></article>}
            </div>
            <button type="button" className="ck2-connected-cta" onClick={continueMember}>
              <Zap /><span><strong>{copy.connectedCta}</strong><small>{copy.connectedCtaSub}</small></span><b>→</b>
            </button>
          </section>
        </main>
      </div>
    );
  }

  if (stage === "member") {
    const connectUrl = pairing?.connectPath ? `${window.location.origin}${pairing.connectPath}` : null;
    return (
      <div className="ck2-shell ck2-member">
        {journeyControl}
        <header className="ck2-topbar">
          <BrandLogo size="md" />
          <div className="ck2-top-actions"><LanguageSwitcher /><button type="button" className="ck2-pill" onClick={returnHome}><X /> {copy.cancel}</button></div>
        </header>
        <main className="ck2-member-grid">
          <section className="ck2-member-copy">
            <span className="ck2-eyebrow">{copy.memberEyebrow}</span>
            <h1>{copy.memberTitle}<br /><strong>{copy.memberTitleAccent}</strong></h1>
            <p>{copy.memberPrivacy}</p>
            <div className="ck2-member-rate-label">{copy.memberRateLabel}</div>
            <div className="ck2-member-rate">{money(options?.member?.hourly_cents, options?.member?.currency)}<small>{copy.perHour}</small></div>
            <div className="ck2-security"><ShieldCheck /> {copy.secure}</div>
          </section>
          <section className="ck2-qr-card">
            <div className="ck2-qr-head"><BrandLogo size="sm" /><span>{copy.memberRateLabel}</span></div>
            {connectUrl && !pairingError ? (
              <div className="ck2-qr-wrap"><QRCodeSVG value={connectUrl} size={330} level="M" bgColor="#ffffff" fgColor="#06090f" marginSize={2} /></div>
            ) : pairingError ? (
              <div className="ck2-member-error"><p>{copy.memberError}</p><button type="button" onClick={() => void startMember()}>{copy.retry}</button></div>
            ) : <Loader2 className="ck2-spin" />}
            <p className="ck2-qr-instruction">{copy.memberScan}</p>
          </section>
        </main>
      </div>
    );
  }

  const guestCurrency = options?.guest?.currency ?? "CHF";
  const guestHourly = money(options?.guest?.hourly_cents, guestCurrency);
  const guestCap = money(options?.guest?.daily_cap_cents, guestCurrency);
  return (
    <div className="ck2-shell ck2-home">
      <div className="ck2-ambient ck2-ambient-a" aria-hidden="true" /><div className="ck2-ambient ck2-ambient-b" aria-hidden="true" />
      <header className="ck2-topbar">
        <BrandLogo size="md" />
        <div className="ck2-top-actions">
          <button type="button" className="ck2-pill" onClick={() => void refreshOptions()} disabled={refreshing}><RefreshCw className={refreshing ? "ck2-spin-small" : ""} /> {copy.refresh}</button>
          <button type="button" className="ck2-pill" onClick={() => window.dispatchEvent(new CustomEvent("chargeurs:open-kiosk-help"))}><HelpCircle /> {copy.help}</button>
          <div className="ck2-language"><LanguageSwitcher /></div>
        </div>
      </header>
      <main className="ck2-home-grid">
        <section className="ck2-hero-copy">
          <span className="ck2-eyebrow">{copy.eyebrow}</span>
          <h1><span>{copy.line1}</span><span>{copy.line2}</span><strong>{copy.accent}</strong></h1>
          <div className="ck2-price-row"><span className="ck2-price-icon"><Zap /></span><strong>{guestHourly}</strong><span>{copy.perHour}</span><i /><span>{copy.dailyCap}</span><strong>{guestCap}</strong></div>
          <div className="ck2-choice-grid">
            <button type="button" className="ck2-choice ck2-choice-express" onClick={chooseGuest} disabled={!options?.guest}><span className="ck2-choice-icon"><Zap /></span><span className="ck2-choice-kicker">{copy.expressKicker}</span><strong>{copy.expressTitle}</strong><small>{copy.expressBody}</small><span className="ck2-arrow">→</span></button>
            <button type="button" className="ck2-choice ck2-choice-member" onClick={() => void startMember()} disabled={!options?.memberAvailable}><span className="ck2-choice-icon"><UserRound /></span><span className="ck2-choice-kicker">{copy.clientKicker}</span><strong>{copy.clientTitle}</strong><small>{copy.clientBody}</small><span className="ck2-arrow">→</span></button>
          </div>
        </section>
        <section className="ck2-device-stage" aria-label="Chargeurs.ch">
          <div className="ck2-device-glow" aria-hidden="true" /><div className="ck2-device"><div className="ck2-device-screen"><BrandLogo size="sm" /><strong>{copy.cabinetTitle}</strong><span>{copy.cabinetSub}</span></div><div className="ck2-device-divider" /><div className="ck2-device-brand"><BrandLogo size="sm" /></div><div className="ck2-device-slots">{[1,2,3,4].map((slot)=><div className={`ck2-device-slot ${slot===1||slot===3?"is-ready":""}`} key={slot}><span /><i>{slot}</i></div>)}</div></div><div className="ck2-device-shadow" aria-hidden="true" />
        </section>
      </main>
    </div>
  );
}
