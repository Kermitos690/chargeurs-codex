import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, CheckCircle2, CreditCard, Loader2, QrCode, RefreshCw, ShieldCheck, Smartphone, Usb } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  buildChargeursPresentationModel,
  type NativeReaderProjection,
  type PaymentRail,
  type PaymentRailState,
} from "@/lib/chargeursPresentationModel";

type NativeTerminalBridge = {
  getPaymentReaderStatus?: () => string;
  refreshPaymentReader?: () => string;
  startTerminalPayment?: (rentalSessionId: string) => string;
};

type NativeWindow = Window & { ChargeursNative?: NativeTerminalBridge };

type Props = {
  lang: "fr" | "en" | "de";
  rentalSessionId: string;
  stationId?: string;
  stationOnline: boolean;
  selectedSlot?: number;
  pricingReady: boolean;
  pricingCurrency?: string;
  inProgress?: boolean;
  onChooseQr: () => void;
  onTerminalEngaged: () => void;
  onServerConfirmed: () => void;
};

const COPY = {
  fr: {
    eyebrow: "PAIEMENT SÉCURISÉ",
    ready: "Choisissez votre mode de paiement",
    readySub: "Deux options simples. Votre batterie ne sera libérée qu’après confirmation sécurisée du paiement.",
    terminal: "Payer sur la borne",
    terminalSub: "Carte, sans contact, Apple Pay ou Google Pay selon disponibilité du terminal.",
    terminalBadge: "LE PLUS RAPIDE",
    qr: "Payer avec votre téléphone",
    qrSub: "Scannez le QR puis validez le paiement sur votre smartphone.",
    qrOnly: "Payez avec votre téléphone",
    qrOnlySub: "Le terminal est momentanément indisponible. Le paiement QR reste disponible.",
    processing: "Présentez votre carte",
    processingSub: "Utilisez le terminal physique situé juste sous l’écran. Vous pouvez approcher votre carte ou l’insérer si nécessaire.",
    waitingBank: "Validation sécurisée en cours…",
    readerReady: "Terminal prêt",
    readerConnecting: "Préparation du terminal…",
    serverConfirmed: "Paiement confirmé",
    followReader: "Suivez maintenant les indications affichées sur le terminal.",
    retry: "Réessayer le terminal",
    locked: "Paiement engagé — ne changez pas de méthode",
    terminalLocation: "TERMINAL SOUS L’ÉCRAN",
    qrAction: "Afficher le QR de paiement",
    terminalAction: "Utiliser le terminal",
    recovery: "Le terminal demande une vérification. Ne recommencez pas le paiement tant que cet écran est affiché.",
  },
  en: {
    eyebrow: "SECURE PAYMENT",
    ready: "Choose how you want to pay",
    readySub: "Two simple options. Your powerbank is released only after secure server confirmation.",
    terminal: "Pay at the kiosk",
    terminalSub: "Card, contactless, Apple Pay or Google Pay when supported by the reader.",
    terminalBadge: "FASTEST",
    qr: "Pay with your phone",
    qrSub: "Scan the QR code and complete payment on your smartphone.",
    qrOnly: "Pay with your phone",
    qrOnlySub: "The payment reader is temporarily unavailable. QR payment remains available.",
    processing: "Present your card",
    processingSub: "Use the physical payment reader directly below the screen. Tap your card or insert it if requested.",
    waitingBank: "Secure validation in progress…",
    readerReady: "Reader ready",
    readerConnecting: "Preparing reader…",
    serverConfirmed: "Payment confirmed",
    followReader: "Now follow the instructions shown on the payment reader.",
    retry: "Retry payment reader",
    locked: "Payment engaged — do not change method",
    terminalLocation: "READER BELOW THE SCREEN",
    qrAction: "Show payment QR",
    terminalAction: "Use payment reader",
    recovery: "The reader requires verification. Do not start another payment while this screen is displayed.",
  },
  de: {
    eyebrow: "SICHERE ZAHLUNG",
    ready: "Zahlungsart wählen",
    readySub: "Zwei einfache Optionen. Die Powerbank wird erst nach sicherer Serverbestätigung ausgegeben.",
    terminal: "An der Station bezahlen",
    terminalSub: "Karte, kontaktlos, Apple Pay oder Google Pay, sofern vom Terminal unterstützt.",
    terminalBadge: "AM SCHNELLSTEN",
    qr: "Mit dem Smartphone bezahlen",
    qrSub: "QR-Code scannen und die Zahlung auf dem Smartphone abschliessen.",
    qrOnly: "Mit dem Smartphone bezahlen",
    qrOnlySub: "Das Terminal ist momentan nicht verfügbar. QR-Zahlung bleibt verfügbar.",
    processing: "Karte an das Terminal halten",
    processingSub: "Benutzen Sie das Zahlungsterminal direkt unter dem Bildschirm. Karte auflegen oder bei Aufforderung einstecken.",
    waitingBank: "Sichere Bestätigung läuft…",
    readerReady: "Terminal bereit",
    readerConnecting: "Terminal wird vorbereitet…",
    serverConfirmed: "Zahlung bestätigt",
    followReader: "Folgen Sie jetzt den Hinweisen auf dem Zahlungsterminal.",
    retry: "Terminal erneut versuchen",
    locked: "Zahlung aktiv — Zahlungsart nicht wechseln",
    terminalLocation: "TERMINAL UNTER DEM BILDSCHIRM",
    qrAction: "Zahlungs-QR anzeigen",
    terminalAction: "Terminal verwenden",
    recovery: "Das Terminal muss geprüft werden. Starten Sie keine zweite Zahlung, solange dieser Bildschirm angezeigt wird.",
  },
} as const;

function parseProjection(raw: string | undefined): NativeReaderProjection | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as NativeReaderProjection;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function humanReaderStatus(
  copy: (typeof COPY)[keyof typeof COPY],
  readerState: string,
  serverConfirmed: boolean,
) {
  if (serverConfirmed) return { label: copy.serverConfirmed, confirmed: true };
  if (["DISCOVERING", "CONNECTING", "RECONNECTING", "UPDATING"].includes(readerState)) {
    return { label: copy.readerConnecting, confirmed: false };
  }
  if (readerState === "READY") return { label: copy.readerReady, confirmed: false };
  return { label: copy.waitingBank, confirmed: false };
}

export function KioskPaymentRailStage({
  lang,
  rentalSessionId,
  stationId,
  stationOnline,
  selectedSlot,
  pricingReady,
  pricingCurrency,
  inProgress = false,
  onChooseQr,
  onTerminalEngaged,
  onServerConfirmed,
}: Props) {
  const copy = COPY[lang];
  const native = (window as NativeWindow).ChargeursNative;
  const nativeBridge = Boolean(native?.getPaymentReaderStatus && native?.startTerminalPayment);
  const [reader, setReader] = useState<NativeReaderProjection | null>(() => parseProjection(native?.getPaymentReaderStatus?.()));
  const [localRail, setLocalRail] = useState<PaymentRail>(inProgress ? "TERMINAL" : "NONE");
  const [localRailState, setLocalRailState] = useState<PaymentRailState>(inProgress ? "ENGAGED" : "UNCLAIMED");
  const [nativeError, setNativeError] = useState<string | null>(null);
  const confirmedRef = useRef(false);
  const railTapLockRef = useRef(inProgress);

  useEffect(() => {
    if (!nativeBridge) return;
    let cancelled = false;
    const refresh = () => {
      const next = parseProjection(native?.getPaymentReaderStatus?.());
      if (!cancelled && next) setReader(next);
    };
    refresh();
    const interval = window.setInterval(refresh, inProgress ? 650 : 1200);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [native, nativeBridge, inProgress]);

  const model = useMemo(() => buildChargeursPresentationModel({
    width: window.innerWidth,
    height: window.innerHeight,
    nativeBridge,
    reducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    journeyState: inProgress ? "PAYMENT_IN_PROGRESS" : "PAYMENT_READY",
    stationId,
    stationOnline,
    selectedSlot,
    pricingReady,
    pricingCurrency,
    reader,
    localRail,
    localRailState,
  }), [nativeBridge, inProgress, stationId, stationOnline, selectedSlot, pricingReady, pricingCurrency, reader, localRail, localRailState]);

  useEffect(() => {
    if (!model.payment.serverConfirmed || confirmedRef.current) return;
    confirmedRef.current = true;
    onServerConfirmed();
  }, [model.payment.serverConfirmed, onServerConfirmed]);

  const chooseTerminal = () => {
    if (railTapLockRef.current || !model.payment.canChooseTerminal || !native?.startTerminalPayment) return;
    railTapLockRef.current = true;
    setNativeError(null);
    setLocalRail("TERMINAL");
    setLocalRailState("CLAIMING");
    let accepted = false;
    try {
      const ack = JSON.parse(native.startTerminalPayment(rentalSessionId)) as { ok?: boolean; code?: string };
      accepted = ack?.ok === true;
      if (!accepted) setNativeError(ack?.code ?? "TERMINAL_START_FAILED");
    } catch {
      setNativeError("TERMINAL_START_FAILED");
    }
    if (!accepted) {
      railTapLockRef.current = false;
      setLocalRail("NONE");
      setLocalRailState("UNCLAIMED");
      return;
    }
    setLocalRailState("ENGAGED");
    onTerminalEngaged();
  };

  const chooseQr = () => {
    if (railTapLockRef.current || !model.payment.canChooseQr) return;
    railTapLockRef.current = true;
    setLocalRail("QR");
    setLocalRailState("CLAIMING");
    onChooseQr();
  };

  const retryReader = () => {
    setNativeError(null);
    const next = parseProjection(native?.refreshPaymentReader?.());
    if (next) setReader(next);
  };

  const readerConnecting = ["DISCOVERING", "CONNECTING", "RECONNECTING", "UPDATING"].includes(model.reader.state);
  const friendly = humanReaderStatus(copy, model.reader.state, model.payment.serverConfirmed);

  if (inProgress || model.payment.rail === "TERMINAL") {
    return (
      <section
        className="kiosk-payment-rail-stage kiosk-payment-terminal-v6 grid w-full max-w-[1180px] grid-cols-[1.08fr_.92fr] items-stretch gap-8 px-5 text-left"
        data-payment-rail="TERMINAL"
        data-reader-state={model.reader.state}
      >
        <div className="relative flex min-h-[470px] flex-col justify-center overflow-hidden rounded-[2.4rem] border border-cyan-200/20 bg-[linear-gradient(145deg,rgba(4,18,38,.96),rgba(2,9,21,.98))] p-10 shadow-[0_34px_90px_rgba(0,0,0,.34),0_0_70px_rgba(34,211,238,.08)]">
          <div aria-hidden className="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-cyan-400/10 blur-[90px]" />
          <div className="relative inline-flex w-fit items-center gap-2 rounded-full border border-cyan-200/20 bg-cyan-300/[.08] px-4 py-2 text-xs font-black tracking-[.16em] text-cyan-100">
            <ShieldCheck className="h-4 w-4" />{copy.eyebrow}
          </div>
          <h2 className="relative mt-7 max-w-[9ch] font-display text-[4.2rem] font-black leading-[.92] tracking-[-.055em] text-white">{copy.processing}</h2>
          <p className="relative mt-5 max-w-xl text-[1.35rem] font-medium leading-snug text-slate-200/75">{copy.processingSub}</p>

          <div className={`relative mt-8 inline-flex w-fit items-center gap-3 rounded-2xl border px-5 py-3 text-base font-black ${friendly.confirmed ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-100" : "border-white/10 bg-white/[.055] text-slate-100"}`} aria-live="polite">
            {friendly.confirmed ? <CheckCircle2 className="h-5 w-5 text-emerald-300" /> : <Loader2 className="h-5 w-5 animate-spin text-cyan-300" />}
            <span>{friendly.label}</span>
          </div>

          {model.journey.state === "RECOVERY" && (
            <p className="relative mt-5 max-w-xl rounded-2xl border border-amber-300/20 bg-amber-300/[.07] px-4 py-3 text-sm font-semibold leading-relaxed text-amber-100">{copy.recovery}</p>
          )}
        </div>

        <div className="relative flex min-h-[470px] flex-col items-center justify-center overflow-hidden rounded-[2.4rem] border border-blue-200/15 bg-[radial-gradient(circle_at_50%_20%,rgba(34,211,238,.14),transparent_38%),linear-gradient(155deg,rgba(5,18,37,.96),rgba(2,8,18,.99))] p-8 text-center shadow-[0_34px_90px_rgba(0,0,0,.3)]">
          <div className="grid h-28 w-28 place-items-center rounded-[2rem] border border-cyan-200/25 bg-cyan-300/[.08] shadow-[0_0_55px_rgba(34,211,238,.15)]">
            <CreditCard className="h-14 w-14 text-cyan-100" />
          </div>
          <div className="mt-6 rounded-full border border-white/10 bg-black/20 px-5 py-2 text-xs font-black tracking-[.18em] text-slate-300">{copy.terminalLocation}</div>
          <ArrowDown className="mt-5 h-16 w-16 animate-bounce text-cyan-300" aria-hidden="true" />
          <p className="mt-2 max-w-sm text-lg font-bold leading-snug text-white">{copy.followReader}</p>
          <div className="mt-6 flex items-center gap-3 text-sm font-semibold text-slate-400">
            <Usb className="h-4 w-4" />
            <span>{copy.locked}</span>
          </div>
        </div>
      </section>
    );
  }

  if (model.reader.capability === "QR_ONLY") {
    return (
      <section className="kiosk-payment-rail-stage kiosk-payment-qr-only-v6 flex w-full max-w-[1050px] flex-col items-center text-center" data-payment-capability="QR_ONLY" data-reader-state={model.reader.state}>
        <div className="w-full rounded-[2.6rem] border border-white/12 bg-[linear-gradient(145deg,rgba(5,17,36,.96),rgba(2,8,18,.98))] px-12 py-10 shadow-[0_34px_90px_rgba(0,0,0,.32)]">
          <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[.05] px-4 py-2 text-xs font-black tracking-[.16em] text-slate-200"><ShieldCheck className="h-4 w-4" />{copy.eyebrow}</div>
          <div className="mx-auto mt-7 grid h-24 w-24 place-items-center rounded-[2rem] border border-blue-200/20 bg-blue-400/10"><Smartphone className="h-12 w-12 text-cyan-100" /></div>
          <h2 className="mt-6 font-display text-6xl font-black tracking-[-.045em] text-white">{copy.qrOnly}</h2>
          <p className="mx-auto mt-4 max-w-3xl text-xl font-medium leading-relaxed text-slate-300/75">{copy.qrOnlySub}</p>
          <Button onClick={chooseQr} disabled={!model.payment.canChooseQr} className="mt-8 h-20 rounded-2xl bg-gradient-primary px-14 text-2xl font-black shadow-[0_18px_45px_rgba(30,144,255,.28)]">
            <QrCode className="mr-3 h-7 w-7" />{copy.qrAction}
          </Button>
          {nativeBridge && readerConnecting && <div className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />{copy.readerConnecting}</div>}
          {nativeBridge && (model.reader.state === "ERROR" || model.reader.state === "ABSENT") && (
            <Button variant="ghost" onClick={retryReader} className="mt-4 h-12 gap-2 rounded-full px-6"><RefreshCw className="h-4 w-4" />{copy.retry}</Button>
          )}
          {nativeError && <p className="mt-4 text-sm font-semibold text-warning">{copy.retry}</p>}
        </div>
      </section>
    );
  }

  return (
    <section className="kiosk-payment-rail-stage kiosk-payment-choice-v6 flex w-full max-w-[1160px] flex-col items-center text-center" data-payment-capability="TERMINAL_AND_QR" data-reader-state={model.reader.state}>
      <div className="inline-flex items-center gap-2 rounded-full border border-cyan-200/20 bg-cyan-300/[.08] px-4 py-2 text-xs font-black tracking-[.16em] text-cyan-100"><ShieldCheck className="h-4 w-4" />{copy.eyebrow}</div>
      <h2 className="mt-5 font-display text-[3.85rem] font-black leading-none tracking-[-.05em] text-white">{copy.ready}</h2>
      <p className="mt-3 max-w-3xl text-lg font-medium leading-relaxed text-slate-300/70">{copy.readySub}</p>

      <div className="mt-8 grid w-full grid-cols-2 gap-7">
        <button type="button" onClick={chooseTerminal} disabled={!model.payment.canChooseTerminal} className="group relative min-h-[300px] overflow-hidden rounded-[2.4rem] border-2 border-emerald-300/45 bg-[radial-gradient(circle_at_20%_0%,rgba(110,231,183,.15),transparent_42%),linear-gradient(145deg,rgba(5,33,27,.98),rgba(2,12,18,.99))] p-8 text-left shadow-[0_28px_72px_rgba(0,0,0,.32),0_0_38px_rgba(110,231,183,.08)] transition active:scale-[.985] disabled:opacity-45">
          <span className="absolute right-6 top-6 rounded-full bg-emerald-300 px-3 py-1 text-[11px] font-black tracking-[.12em] text-emerald-950">{copy.terminalBadge}</span>
          <div className="flex items-center gap-4"><span className="grid h-16 w-16 place-items-center rounded-2xl border border-emerald-200/20 bg-emerald-300/10"><CreditCard className="h-8 w-8 text-emerald-100" /></span><Usb className="h-6 w-6 text-emerald-100/50" /></div>
          <div className="mt-10 font-display text-[2.1rem] font-black leading-none tracking-tight text-white">{copy.terminal}</div>
          <p className="mt-4 max-w-md text-lg font-medium leading-relaxed text-slate-300/75">{copy.terminalSub}</p>
          <div className="absolute bottom-7 right-7 grid h-12 w-12 place-items-center rounded-full border border-emerald-200/25 bg-emerald-300/10 text-2xl text-emerald-100">→</div>
        </button>

        <button type="button" onClick={chooseQr} disabled={!model.payment.canChooseQr} className="group relative min-h-[300px] overflow-hidden rounded-[2.4rem] border border-blue-200/25 bg-[radial-gradient(circle_at_20%_0%,rgba(56,189,248,.13),transparent_42%),linear-gradient(145deg,rgba(5,24,47,.98),rgba(2,10,22,.99))] p-8 text-left shadow-[0_28px_72px_rgba(0,0,0,.3)] transition active:scale-[.985] disabled:opacity-45">
          <span className="grid h-16 w-16 place-items-center rounded-2xl border border-cyan-200/20 bg-cyan-300/10"><QrCode className="h-8 w-8 text-cyan-100" /></span>
          <div className="mt-10 font-display text-[2.1rem] font-black leading-none tracking-tight text-white">{copy.qr}</div>
          <p className="mt-4 max-w-md text-lg font-medium leading-relaxed text-slate-300/75">{copy.qrSub}</p>
          <div className="absolute bottom-7 right-7 grid h-12 w-12 place-items-center rounded-full border border-cyan-200/20 bg-cyan-300/10 text-2xl text-cyan-100">→</div>
        </button>
      </div>
      {nativeError && <p className="mt-5 rounded-full border border-amber-300/20 bg-amber-300/[.07] px-5 py-2 text-sm font-semibold text-amber-100">{copy.retry}</p>}
    </section>
  );
}
