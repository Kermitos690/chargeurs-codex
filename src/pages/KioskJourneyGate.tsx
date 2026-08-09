import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, CheckCircle2, Clock3, Loader2, QrCode, RefreshCw, Smartphone, UserRound, Zap } from "lucide-react";
import Kiosk from "./Kiosk";
import { BrandLogo } from "@/components/BrandLogo";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { LiquidBackground } from "@/components/LiquidBackground";
import { Button } from "@/components/ui/button";
import { readKioskToken } from "@/lib/kioskFetch";
import {
  invokeKioskEdgeProxy,
  KIOSK_JOURNEY_STORAGE_KEY,
  KIOSK_PAIRING_STORAGE_KEY,
} from "@/lib/kioskEdgeProxy";
import { useI18n } from "@/i18n/i18n";

type SegmentPrice = {
  segment: "guest" | "member";
  currency: string;
  hourly_cents: number | null;
  period_minutes: number;
  price_per_period_cents: number;
  daily_cap_cents: number;
  profile_name: string;
};

type CustomerOptions = {
  ok?: boolean;
  guest?: SegmentPrice;
  member?: SegmentPrice | null;
  memberAvailable?: boolean;
  error?: string;
};

type PairingCreate = {
  ok?: boolean;
  pairingId?: string;
  token?: string;
  connectPath?: string;
  expiresAt?: string;
  error?: string;
};

type PairingStatus = {
  ok?: boolean;
  state?: string;
  connected?: boolean;
  displayName?: string;
  preferredLanguage?: string | null;
  segment?: string;
  expiresAt?: string;
  error?: string;
};

type ResumeSession = {
  id: string;
  publicCode: string | null;
  state: string;
  stateVersion: number;
  selectedSlotNum: number | null;
  failureCode: string | null;
  checkoutUrl: string | null;
  checkoutExpiresAt: string | null;
  expiresAt: string | null;
};

type ResumeResponse = {
  ok?: boolean;
  active?: boolean;
  session?: ResumeSession | null;
  error?: string;
};

type Journey = "guest" | "member";
type GateView = "choose" | "pairing" | "connected" | "kiosk";

const copy = {
  fr: {
    title: "Comment souhaitez-vous louer ?",
    subtitle: "Deux parcours simples. Choisissez celui qui vous convient.",
    guestBadge: "SANS COMPTE",
    guestTitle: "Location express",
    guestBody: "Louez tout de suite. Paiement sur votre téléphone.",
    guestCta: "Continuer sans compte",
    memberBadge: "CLIENT CHARGEURS",
    memberTitle: "Tarif client",
    memberBody: "Connectez votre compte avec l’app et profitez du meilleur tarif.",
    memberCta: "Se connecter avec l’app",
    scanTitle: "Scannez avec l’app Chargeurs",
    scanBody: "Ouvrez votre compte Chargeurs → Scanner une borne. La connexion est automatique.",
    scanFallback: "Vous pouvez aussi scanner ce QR avec l’appareil photo : le lien ouvrira votre compte Chargeurs.",
    waiting: "En attente de votre app…",
    expires: "QR valable encore {{seconds}} s",
    connected: "Connecté !",
    hello: "Bonjour {{name}}",
    connectedBody: "Votre tarif client est actif sur cette borne.",
    continue: "Choisir ma batterie",
    back: "Changer de parcours",
    unavailable: "Connexion client temporairement indisponible",
    rate: "Tarif",
    memberRate: "Tarif client",
    ratesUnavailable: "Tarifs momentanément indisponibles — actualisation en cours.",
    resumeChecking: "Récupération de votre location…",
    resumeCheckoutTitle: "Votre paiement est toujours prêt",
    resumeCheckoutBody: "Scannez le QR pour continuer sur votre téléphone.",
    resumeProcessingTitle: "Paiement confirmé",
    resumeProcessingBody: "Votre location est en cours. Ne lancez pas une deuxième location.",
    resumeSupportTitle: "Vérification en cours",
    resumeSupportBody: "Votre paiement est sécurisé. La borne conserve votre location pendant la vérification.",
    resumeSuccessTitle: "Prenez votre batterie",
    resumeSuccessBody: "La borne a repris votre location après le redémarrage.",
    resumeSession: "Location en cours",
  },
  en: {
    title: "How would you like to rent?",
    subtitle: "Two simple journeys. Pick the one that suits you.",
    guestBadge: "NO ACCOUNT",
    guestTitle: "Express rental",
    guestBody: "Rent right away. Pay on your phone.",
    guestCta: "Continue without an account",
    memberBadge: "CHARGEURS CUSTOMER",
    memberTitle: "Customer rate",
    memberBody: "Connect your account with the app and get the best rate.",
    memberCta: "Connect with the app",
    scanTitle: "Scan with the Chargeurs app",
    scanBody: "Open your Chargeurs account → Scan a station. Connection is automatic.",
    scanFallback: "You can also scan this QR with your camera; the link opens your Chargeurs account.",
    waiting: "Waiting for your app…",
    expires: "QR valid for {{seconds}} s",
    connected: "Connected!",
    hello: "Hello {{name}}",
    connectedBody: "Your customer rate is active on this station.",
    continue: "Choose my powerbank",
    back: "Change journey",
    unavailable: "Customer connection temporarily unavailable",
    rate: "Rate",
    memberRate: "Customer rate",
    ratesUnavailable: "Rates are temporarily unavailable — refreshing.",
    resumeChecking: "Recovering your rental…",
    resumeCheckoutTitle: "Your payment is still ready",
    resumeCheckoutBody: "Scan the QR to continue on your phone.",
    resumeProcessingTitle: "Payment confirmed",
    resumeProcessingBody: "Your rental is in progress. Please do not start a second rental.",
    resumeSupportTitle: "Verification in progress",
    resumeSupportBody: "Your payment is secure. The station keeps your rental while it verifies the release.",
    resumeSuccessTitle: "Take your powerbank",
    resumeSuccessBody: "The station recovered your rental after the restart.",
    resumeSession: "Rental in progress",
  },
  de: {
    title: "Wie möchten Sie mieten?",
    subtitle: "Zwei einfache Wege. Wählen Sie den passenden.",
    guestBadge: "OHNE KONTO",
    guestTitle: "Express-Miete",
    guestBody: "Sofort mieten. Bezahlen Sie auf Ihrem Handy.",
    guestCta: "Ohne Konto fortfahren",
    memberBadge: "CHARGEURS KUNDE",
    memberTitle: "Kundentarif",
    memberBody: "Verbinden Sie Ihr Konto mit der App und nutzen Sie den besten Tarif.",
    memberCta: "Mit der App verbinden",
    scanTitle: "Mit der Chargeurs App scannen",
    scanBody: "Öffnen Sie Ihr Chargeurs Konto → Station scannen. Die Verbindung erfolgt automatisch.",
    scanFallback: "Sie können den QR auch mit der Kamera scannen; der Link öffnet Ihr Chargeurs Konto.",
    waiting: "Warten auf Ihre App…",
    expires: "QR noch {{seconds}} s gültig",
    connected: "Verbunden!",
    hello: "Hallo {{name}}",
    connectedBody: "Ihr Kundentarif ist an dieser Station aktiv.",
    continue: "Powerbank auswählen",
    back: "Mietweg ändern",
    unavailable: "Kundenverbindung vorübergehend nicht verfügbar",
    rate: "Tarif",
    memberRate: "Kundentarif",
    ratesUnavailable: "Tarife vorübergehend nicht verfügbar — Aktualisierung läuft.",
    resumeChecking: "Miete wird wiederhergestellt…",
    resumeCheckoutTitle: "Ihre Zahlung ist weiterhin bereit",
    resumeCheckoutBody: "Scannen Sie den QR, um auf Ihrem Handy fortzufahren.",
    resumeProcessingTitle: "Zahlung bestätigt",
    resumeProcessingBody: "Ihre Miete läuft. Bitte starten Sie keine zweite Miete.",
    resumeSupportTitle: "Prüfung läuft",
    resumeSupportBody: "Ihre Zahlung ist sicher. Die Station behält Ihre Miete während der Prüfung.",
    resumeSuccessTitle: "Nehmen Sie Ihre Powerbank",
    resumeSuccessBody: "Die Station hat Ihre Miete nach dem Neustart wiederhergestellt.",
    resumeSession: "Miete läuft",
  },
} as const;

function money(cents: number | null | undefined, currency = "CHF") {
  return cents == null ? "—" : `${(cents / 100).toFixed(2)} ${currency}`;
}

function isResumeSuccess(state: string) {
  return ["ejected", "battery_taken", "active_rental"].includes(state);
}

function isResumeSupport(state: string) {
  return ["needs_support", "eject_failed", "failed"].includes(state);
}

function isResumeCheckout(session: ResumeSession) {
  return ["created", "payment_pending"].includes(session.state) && Boolean(session.checkoutUrl);
}

export default function KioskJourneyGate() {
  const { stationId = "" } = useParams();
  const { lang } = useI18n();
  const c = copy[lang];
  const [view, setView] = useState<GateView>("choose");
  const [journey, setJourney] = useState<Journey | null>(null);
  const [options, setOptions] = useState<CustomerOptions | null>(null);
  const [optionsError, setOptionsError] = useState(false);
  const [pairing, setPairing] = useState<PairingCreate | null>(null);
  const [pairingName, setPairingName] = useState("Client");
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [resumeChecked, setResumeChecked] = useState(false);
  const [resumeSession, setResumeSession] = useState<ResumeSession | null>(null);

  useEffect(() => {
    document.documentElement.classList.add("kiosk-mode");
    return () => document.documentElement.classList.remove("kiosk-mode");
  }, []);

  const clearJourney = useCallback(() => {
    try {
      sessionStorage.removeItem(KIOSK_JOURNEY_STORAGE_KEY);
      sessionStorage.removeItem(KIOSK_PAIRING_STORAGE_KEY);
    } catch { /* storage is not an authority */ }
    setJourney(null);
    setPairing(null);
    setPairingName("Client");
    setPairingError(null);
    setView("choose");
  }, []);

  const refreshResumeState = useCallback(async (initial = false) => {
    const token = readKioskToken();
    if (!token || !stationId) {
      if (initial) setResumeChecked(true);
      return;
    }
    const { data, transportError } = await invokeKioskEdgeProxy<ResumeResponse>(
      "/api/kiosk/resume-state",
      { stationId },
      { "X-Kiosk-Token": token },
    );
    if (transportError || !data?.ok) {
      // On first boot fail closed visually: the normal kiosk can still show its
      // network state, but we never erase a previously recovered paid session
      // merely because one refresh failed.
      if (initial) setResumeChecked(true);
      return;
    }
    if (data.active && data.session?.id) {
      setResumeSession(data.session);
    } else {
      setResumeSession(null);
    }
    setResumeChecked(true);
  }, [stationId]);

  // Recovery is checked before any new rental choice is offered. sessionStorage
  // may disappear on Android/WebView restart; the server remains authoritative.
  useEffect(() => {
    setResumeChecked(false);
    void refreshResumeState(true);
  }, [refreshResumeState]);

  // Keep a recovered rental alive on screen and reconcile only through the
  // read-only physical-delta endpoint. No path here can issue an ejection.
  useEffect(() => {
    if (!resumeSession) return;
    let cancelled = false;
    const poll = async () => {
      if (resumeSession.state === "ejecting" && resumeSession.publicCode) {
        const token = readKioskToken();
        if (token) {
          await invokeKioskEdgeProxy(
            "/api/kiosk/reconcile-pending-ejection",
            { stationId, rentalSessionId: resumeSession.id, publicCode: resumeSession.publicCode },
            { "X-Kiosk-Token": token },
          );
        }
      }
      if (!cancelled) await refreshResumeState(false);
    };
    const interval = window.setInterval(() => void poll(), 2500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [refreshResumeState, resumeSession, stationId]);

  // After a recovered successful release, return to the public choice screen.
  // This only changes UI state; it does not mutate the server rental.
  useEffect(() => {
    if (!resumeSession || !isResumeSuccess(resumeSession.state)) return;
    const timer = window.setTimeout(() => {
      setResumeSession(null);
      clearJourney();
    }, 12_000);
    return () => window.clearTimeout(timer);
  }, [clearJourney, resumeSession]);

  useEffect(() => {
    const onTerminal = () => window.setTimeout(clearJourney, 13_000);
    window.addEventListener("chargeurs:kiosk-flow-complete", onTerminal);
    return () => window.removeEventListener("chargeurs:kiosk-flow-complete", onTerminal);
  }, [clearJourney]);

  const loadOptions = useCallback(async () => {
    const token = readKioskToken();
    if (!token || !stationId) { setOptionsError(true); return; }
    const { data, transportError } = await invokeKioskEdgeProxy<CustomerOptions>(
      "/api/kiosk/customer-options",
      { stationId },
      { "X-Kiosk-Token": token },
    );
    if (transportError || !data?.ok || !data.guest) {
      setOptionsError(true);
      return;
    }
    setOptions(data);
    setOptionsError(false);
  }, [stationId]);

  useEffect(() => {
    if (!resumeChecked || resumeSession) return;
    void loadOptions();
  }, [loadOptions, resumeChecked, resumeSession]);

  useEffect(() => {
    if (view !== "pairing") return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [view]);

  const chooseGuest = () => {
    clearJourney();
    try { sessionStorage.setItem(KIOSK_JOURNEY_STORAGE_KEY, "guest"); } catch { /* noop */ }
    setJourney("guest");
    setView("kiosk");
  };

  const startMemberPairing = async () => {
    const token = readKioskToken();
    if (!token || !stationId || !options?.memberAvailable) return;
    setJourney("member");
    setPairingError(null);
    setView("pairing");
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
    if (view !== "pairing" || !pairing?.pairingId) return;
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
        setPairingName(data.displayName || "Client");
        try {
          sessionStorage.setItem(KIOSK_JOURNEY_STORAGE_KEY, "member");
          sessionStorage.setItem(KIOSK_PAIRING_STORAGE_KEY, pairing.pairingId!);
        } catch { /* server validates the pairing anyway */ }
        setView("connected");
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 900);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [pairing?.pairingId, stationId, view]);

  useEffect(() => {
    if (view !== "connected") return;
    const timer = window.setTimeout(() => setView("kiosk"), 1200);
    return () => window.clearTimeout(timer);
  }, [view]);

  const connectUrl = pairing?.connectPath ? `${window.location.origin}${pairing.connectPath}` : null;
  const secondsLeft = pairing?.expiresAt ? Math.max(0, Math.ceil((Date.parse(pairing.expiresAt) - now) / 1000)) : 0;
  const interpolate = (value: string, values: Record<string, string | number>) => Object.entries(values).reduce((out, [key, item]) => out.replace(`{{${key}}}`, String(item)), value);

  if (!resumeChecked) {
    return (
      <div className="kiosk-root fixed inset-0 grid place-items-center overflow-hidden bg-background">
        <LiquidBackground />
        <div className="relative z-10 flex flex-col items-center gap-5 text-center">
          <Loader2 className="h-16 w-16 animate-spin text-primary" />
          <p className="font-display text-3xl font-bold">{c.resumeChecking}</p>
        </div>
      </div>
    );
  }

  if (resumeSession) {
    const checkout = isResumeCheckout(resumeSession);
    const success = isResumeSuccess(resumeSession.state);
    const support = isResumeSupport(resumeSession.state);
    const title = success ? c.resumeSuccessTitle
      : support ? c.resumeSupportTitle
      : checkout ? c.resumeCheckoutTitle
      : c.resumeProcessingTitle;
    const body = success ? c.resumeSuccessBody
      : support ? c.resumeSupportBody
      : checkout ? c.resumeCheckoutBody
      : c.resumeProcessingBody;

    return (
      <div className="kiosk-root fixed inset-0 overflow-hidden bg-background">
        <LiquidBackground />
        <header className="absolute inset-x-0 top-0 z-20 flex h-16 items-center justify-between px-5 sm:px-8">
          <BrandLogo size="md" />
          <LanguageSwitcher />
        </header>
        <main className="absolute inset-x-0 bottom-0 top-16 grid place-items-center overflow-hidden p-4 sm:p-7">
          <motion.section initial={{ opacity: 0, scale: .97 }} animate={{ opacity: 1, scale: 1 }} className="grid w-full max-w-6xl items-center gap-8 lg:grid-cols-[1fr_.9fr]">
            <div className="text-center lg:text-left">
              <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-bold text-primary">
                <RefreshCw className="h-4 w-4" />{c.resumeSession}
              </span>
              <h1 className="mt-6 font-display text-4xl font-extrabold sm:text-6xl">{title}</h1>
              <p className="mt-5 text-xl leading-relaxed text-muted-foreground sm:text-2xl">{body}</p>
              {resumeSession.selectedSlotNum != null && (
                <div className="mt-7 inline-flex rounded-[2rem] border border-primary/30 bg-primary/10 px-8 py-5">
                  <span className="font-display text-4xl font-extrabold text-gradient-cyan">Slot {resumeSession.selectedSlotNum}</span>
                </div>
              )}
            </div>

            <div className="glass-strong liquid-border flex min-h-[25rem] flex-col items-center justify-center rounded-[2.5rem] p-8 text-center">
              {checkout && resumeSession.checkoutUrl ? (
                <>
                  <div className="rounded-[2rem] bg-white p-5 shadow-2xl">
                    <QRCodeSVG value={resumeSession.checkoutUrl} size={300} level="M" />
                  </div>
                  <p className="mt-5 text-lg font-bold text-primary">{c.resumeCheckoutBody}</p>
                </>
              ) : success ? (
                <>
                  <motion.div initial={{ scale: .5 }} animate={{ scale: 1 }} className="grid h-32 w-32 place-items-center rounded-full bg-success/15 shadow-glow-success">
                    <CheckCircle2 className="h-20 w-20 text-success" />
                  </motion.div>
                  {resumeSession.selectedSlotNum != null && <p className="mt-6 font-display text-7xl font-extrabold text-gradient-cyan">{resumeSession.selectedSlotNum}</p>}
                </>
              ) : (
                <>
                  <Loader2 className={`h-20 w-20 ${support ? "text-warning" : "animate-spin text-primary"}`} />
                  <p className="mt-6 max-w-sm text-lg text-muted-foreground">{body}</p>
                </>
              )}
            </div>
          </motion.section>
        </main>
      </div>
    );
  }

  if (view === "kiosk" && journey) return <Kiosk />;

  return (
    <div className="kiosk-root fixed inset-0 overflow-hidden bg-background">
      <LiquidBackground />
      <header className="absolute inset-x-0 top-0 z-20 flex h-16 items-center justify-between px-5 sm:px-8">
        <BrandLogo size="md" />
        <LanguageSwitcher />
      </header>
      <main className="absolute inset-x-0 bottom-0 top-16 grid place-items-center overflow-hidden p-4 sm:p-7">
        <AnimatePresence mode="wait">
          {view === "choose" && (
            <motion.section key="choose" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="w-full max-w-[92rem]">
              <div className="mb-7 text-center">
                <h1 className="font-display text-4xl font-extrabold tracking-tight sm:text-6xl">{c.title}</h1>
                <p className="mt-3 text-lg text-muted-foreground sm:text-2xl">{c.subtitle}</p>
              </div>

              <div className="grid gap-5 lg:grid-cols-2">
                <button type="button" onClick={chooseGuest} disabled={!options?.guest}
                  className="group relative min-h-[23rem] overflow-hidden rounded-[2.5rem] border border-blue-400/35 bg-blue-500/10 p-7 text-left shadow-[0_0_70px_rgba(59,130,246,.13)] transition hover:-translate-y-1 hover:border-blue-300/70 hover:bg-blue-500/15 disabled:opacity-50 sm:p-10">
                  <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-blue-500/20 blur-3xl" />
                  <span className="relative inline-flex rounded-full border border-blue-300/30 bg-blue-400/10 px-4 py-2 text-sm font-extrabold tracking-wide text-blue-200">{c.guestBadge}</span>
                  <div className="relative mt-7 flex items-start justify-between gap-5">
                    <div><h2 className="font-display text-4xl font-extrabold sm:text-5xl">{c.guestTitle}</h2><p className="mt-4 max-w-xl text-lg text-blue-100/70 sm:text-xl">{c.guestBody}</p></div>
                    <Zap className="h-16 w-16 shrink-0 text-blue-300" />
                  </div>
                  <div className="relative mt-10 flex items-end justify-between gap-4">
                    <div><p className="text-sm font-semibold text-blue-200/70">{c.rate}</p><p className="font-display text-5xl font-extrabold text-blue-200">{money(options?.guest?.hourly_cents, options?.guest?.currency)}<span className="ml-2 text-xl">/ h</span></p></div>
                    <span className="grid h-14 w-14 place-items-center rounded-full bg-blue-400 text-slate-950 transition group-hover:translate-x-1"><ArrowRight className="h-7 w-7" /></span>
                  </div>
                  <p className="relative mt-7 text-base font-bold text-blue-100">{c.guestCta}</p>
                </button>

                <button type="button" onClick={() => void startMemberPairing()} disabled={!options?.memberAvailable}
                  className="group relative min-h-[23rem] overflow-hidden rounded-[2.5rem] border border-emerald-400/40 bg-emerald-500/10 p-7 text-left shadow-[0_0_80px_rgba(16,185,129,.16)] transition hover:-translate-y-1 hover:border-emerald-300/80 hover:bg-emerald-500/15 disabled:opacity-45 sm:p-10">
                  <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-emerald-400/20 blur-3xl" />
                  <span className="relative inline-flex rounded-full border border-emerald-300/30 bg-emerald-400/10 px-4 py-2 text-sm font-extrabold tracking-wide text-emerald-200">{c.memberBadge}</span>
                  <div className="relative mt-7 flex items-start justify-between gap-5">
                    <div><h2 className="font-display text-4xl font-extrabold text-emerald-50 sm:text-5xl">{c.memberTitle}</h2><p className="mt-4 max-w-xl text-lg text-emerald-100/70 sm:text-xl">{c.memberBody}</p></div>
                    <UserRound className="h-16 w-16 shrink-0 text-emerald-300" />
                  </div>
                  <div className="relative mt-10 flex items-end justify-between gap-4">
                    <div><p className="text-sm font-semibold text-emerald-200/70">{c.memberRate}</p><p className="font-display text-5xl font-extrabold text-emerald-300">{money(options?.member?.hourly_cents, options?.member?.currency)}<span className="ml-2 text-xl">/ h</span></p></div>
                    <span className="grid h-14 w-14 place-items-center rounded-full bg-emerald-400 text-slate-950 transition group-hover:translate-x-1"><QrCode className="h-7 w-7" /></span>
                  </div>
                  <p className="relative mt-7 text-base font-bold text-emerald-100">{options?.memberAvailable ? c.memberCta : c.unavailable}</p>
                </button>
              </div>
              {optionsError && <p className="mt-4 text-center text-sm text-warning">{c.ratesUnavailable}</p>}
            </motion.section>
          )}

          {view === "pairing" && (
            <motion.section key="pairing" initial={{ opacity: 0, scale: .97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="grid w-full max-w-6xl items-center gap-8 lg:grid-cols-[1fr_.9fr]">
              <div className="text-center lg:text-left">
                <span className="inline-flex items-center gap-2 rounded-full border border-emerald-300/30 bg-emerald-400/10 px-4 py-2 text-sm font-bold text-emerald-300"><Smartphone className="h-4 w-4" />{c.memberBadge}</span>
                <h1 className="mt-6 font-display text-4xl font-extrabold text-emerald-50 sm:text-6xl">{c.scanTitle}</h1>
                <p className="mt-5 text-xl leading-relaxed text-muted-foreground">{c.scanBody}</p>
                <div className="mt-7 rounded-3xl border border-emerald-400/20 bg-emerald-400/10 p-5">
                  <p className="text-sm text-emerald-100/70">{c.memberRate}</p>
                  <p className="mt-1 font-display text-5xl font-extrabold text-emerald-300">{money(options?.member?.hourly_cents, options?.member?.currency)} / h</p>
                </div>
                <Button onClick={clearJourney} variant="ghost" className="mt-6 rounded-full px-6 py-5">{c.back}</Button>
              </div>

              <div className="glass-strong liquid-border flex flex-col items-center rounded-[2.5rem] p-7 text-center sm:p-9">
                {connectUrl && !pairingError ? (
                  <div className="rounded-[2rem] bg-white p-5 shadow-2xl"><QRCodeSVG value={connectUrl} size={300} level="M" /></div>
                ) : pairingError ? (
                  <div className="grid h-64 w-64 place-items-center rounded-[2rem] border border-warning/30 bg-warning/10 p-6 text-warning">{c.unavailable}</div>
                ) : (
                  <div className="grid h-64 w-64 place-items-center rounded-[2rem] bg-white/5"><Loader2 className="h-12 w-12 animate-spin text-emerald-300" /></div>
                )}
                <p className="mt-6 flex items-center gap-2 text-lg font-bold text-emerald-200"><Loader2 className="h-5 w-5 animate-spin" />{c.waiting}</p>
                {pairing?.expiresAt && <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground"><Clock3 className="h-4 w-4" />{interpolate(c.expires, { seconds: secondsLeft })}</p>}
                <p className="mt-4 max-w-sm text-sm text-muted-foreground">{c.scanFallback}</p>
              </div>
            </motion.section>
          )}

          {view === "connected" && (
            <motion.section key="connected" initial={{ opacity: 0, scale: .9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.04 }} className="text-center">
              <motion.div initial={{ scale: .4, rotate: -12 }} animate={{ scale: 1, rotate: 0 }} className="mx-auto grid h-32 w-32 place-items-center rounded-full bg-emerald-400/15 shadow-[0_0_100px_rgba(52,211,153,.45)]">
                <CheckCircle2 className="h-20 w-20 text-emerald-300" />
              </motion.div>
              <p className="mt-7 text-lg font-bold uppercase tracking-[.2em] text-emerald-300">{c.connected}</p>
              <h1 className="mt-3 font-display text-6xl font-extrabold text-emerald-50">{interpolate(c.hello, { name: pairingName })}</h1>
              <p className="mt-4 text-2xl text-muted-foreground">{c.connectedBody}</p>
              <p className="mt-6 font-display text-5xl font-extrabold text-emerald-300">{money(options?.member?.hourly_cents, options?.member?.currency)} / h</p>
            </motion.section>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
