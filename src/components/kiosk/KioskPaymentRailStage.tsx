import { useEffect, useMemo, useRef, useState } from "react";
import { CreditCard, Loader2, QrCode, RefreshCw, ShieldCheck, Usb } from "lucide-react";
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
    ready: "Comment souhaitez-vous payer ?",
    terminal: "Payer sur la borne",
    terminalSub: "Carte ou sans contact sur le terminal",
    qr: "Payer par QR",
    qrSub: "Scannez et payez sur votre téléphone",
    qrOnly: "Paiement par téléphone",
    qrOnlySub: "Le terminal n’est pas disponible pour le moment. Le QR reste disponible normalement.",
    processing: "Paiement Terminal en cours",
    processingSub: "Suivez les instructions sur le lecteur. Le paiement n’est confirmé qu’après validation serveur.",
    reconnecting: "Connexion au lecteur…",
    retry: "Réessayer le lecteur",
    locked: "Méthode de paiement engagée",
  },
  en: {
    eyebrow: "SECURE PAYMENT",
    ready: "How would you like to pay?",
    terminal: "Pay at the kiosk",
    terminalSub: "Card or contactless on the payment reader",
    qr: "Pay by QR",
    qrSub: "Scan and pay on your phone",
    qrOnly: "Pay on your phone",
    qrOnlySub: "The reader is not available right now. QR payment remains normally available.",
    processing: "Terminal payment in progress",
    processingSub: "Follow the reader instructions. Payment is confirmed only after server validation.",
    reconnecting: "Connecting reader…",
    retry: "Retry reader",
    locked: "Payment method engaged",
  },
  de: {
    eyebrow: "SICHERE ZAHLUNG",
    ready: "Wie möchten Sie bezahlen?",
    terminal: "An der Station bezahlen",
    terminalSub: "Karte oder kontaktlos am Zahlungsterminal",
    qr: "Per QR bezahlen",
    qrSub: "Scannen und auf dem Smartphone bezahlen",
    qrOnly: "Auf dem Smartphone bezahlen",
    qrOnlySub: "Das Terminal ist momentan nicht verfügbar. QR-Zahlung bleibt normal verfügbar.",
    processing: "Terminal-Zahlung läuft",
    processingSub: "Folgen Sie den Anweisungen am Leser. Die Zahlung gilt erst nach Serverbestätigung als bestätigt.",
    reconnecting: "Leser wird verbunden…",
    retry: "Leser erneut verbinden",
    locked: "Zahlungsart aktiv",
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
    // Synchronous ref lock closes the pre-render double-tap window; the Agent 2
    // backend remains authoritative and atomically enforces first-rail-wins.
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

  if (inProgress || model.payment.rail === "TERMINAL") {
    return (
      <div className="kiosk-payment-rail-stage flex w-full max-w-5xl flex-col items-center gap-7 px-5 text-center" data-payment-rail="TERMINAL" data-reader-state={model.reader.state}>
        <div className="inline-flex items-center gap-2 rounded-full border border-cyan-200/20 bg-cyan-300/10 px-4 py-2 text-sm font-black tracking-[.14em] text-cyan-100">
          <ShieldCheck className="h-4 w-4" />{copy.eyebrow}
        </div>
        <div className="grid h-24 w-24 place-items-center rounded-[2rem] border border-cyan-200/25 bg-cyan-300/10 shadow-[0_0_48px_rgba(34,211,238,.2)]">
          <CreditCard className="h-12 w-12 text-cyan-100" />
        </div>
        <h2 className="font-display text-5xl font-black tracking-tight">{copy.processing}</h2>
        <p className="max-w-3xl text-xl font-medium text-muted-foreground">{copy.processingSub}</p>
        <div className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/5 px-5 py-3 text-base font-bold">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <span>{model.payment.serverConfirmed ? "SERVER CONFIRMED" : `${model.reader.state} · ${model.payment.railState}`}</span>
        </div>
        {model.journey.state === "RECOVERY" && <p className="max-w-2xl text-base font-semibold text-warning">{copy.locked} · {model.reader.safeMessageCode ?? "RECOVERY_REQUIRED"}</p>}
      </div>
    );
  }

  if (model.reader.capability === "QR_ONLY") {
    return (
      <div className="kiosk-payment-rail-stage flex w-full max-w-5xl flex-col items-center gap-7 px-5 text-center" data-payment-capability="QR_ONLY" data-reader-state={model.reader.state}>
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-black tracking-[.14em] text-slate-200"><ShieldCheck className="h-4 w-4" />{copy.eyebrow}</div>
        <QrCode className="h-20 w-20 text-primary" />
        <h2 className="font-display text-5xl font-black tracking-tight">{copy.qrOnly}</h2>
        <p className="max-w-3xl text-xl font-medium text-muted-foreground">{copy.qrOnlySub}</p>
        <Button onClick={chooseQr} disabled={!model.payment.canChooseQr} className="h-20 rounded-full bg-gradient-primary px-14 text-2xl font-black shadow-glow">
          <QrCode className="mr-3 h-7 w-7" />{copy.qr}
        </Button>
        {nativeBridge && readerConnecting && <div className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{copy.reconnecting}</div>}
        {nativeBridge && (model.reader.state === "ERROR" || model.reader.state === "ABSENT") && (
          <Button variant="ghost" onClick={retryReader} className="h-12 gap-2 rounded-full px-6"><RefreshCw className="h-4 w-4" />{copy.retry}</Button>
        )}
        {nativeError && <p className="text-sm font-semibold text-warning">{nativeError}</p>}
      </div>
    );
  }

  return (
    <div className="kiosk-payment-rail-stage flex w-full max-w-6xl flex-col items-center gap-7 px-5 text-center" data-payment-capability="TERMINAL_AND_QR" data-reader-state={model.reader.state}>
      <div className="inline-flex items-center gap-2 rounded-full border border-cyan-200/20 bg-cyan-300/10 px-4 py-2 text-sm font-black tracking-[.14em] text-cyan-100"><ShieldCheck className="h-4 w-4" />{copy.eyebrow}</div>
      <h2 className="font-display text-5xl font-black tracking-tight sm:text-6xl">{copy.ready}</h2>
      <div className="grid w-full grid-cols-1 gap-6 md:grid-cols-2">
        <button type="button" onClick={chooseTerminal} disabled={!model.payment.canChooseTerminal} className="group min-h-64 rounded-[2.25rem] border border-cyan-200/25 bg-cyan-300/[.08] p-8 text-left shadow-[0_24px_70px_rgba(0,0,0,.22)] transition hover:-translate-y-1 disabled:opacity-50">
          <div className="flex items-center justify-between"><CreditCard className="h-12 w-12 text-cyan-100" /><Usb className="h-7 w-7 text-cyan-100/65" /></div>
          <div className="mt-12 font-display text-3xl font-black">{copy.terminal}</div>
          <p className="mt-3 text-lg font-medium text-muted-foreground">{copy.terminalSub}</p>
        </button>
        <button type="button" onClick={chooseQr} disabled={!model.payment.canChooseQr} className="group min-h-64 rounded-[2.25rem] border border-white/15 bg-white/[.055] p-8 text-left shadow-[0_24px_70px_rgba(0,0,0,.2)] transition hover:-translate-y-1 disabled:opacity-50">
          <QrCode className="h-12 w-12 text-primary" />
          <div className="mt-12 font-display text-3xl font-black">{copy.qr}</div>
          <p className="mt-3 text-lg font-medium text-muted-foreground">{copy.qrSub}</p>
        </button>
      </div>
      <div className="text-sm font-semibold text-muted-foreground">{model.reader.state} · {model.reader.capability}</div>
      {nativeError && <p className="text-sm font-semibold text-warning">{nativeError}</p>}
    </div>
  );
}
