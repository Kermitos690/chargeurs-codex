import { useEffect, useMemo, useRef, useState } from "react";
import { CreditCard, Loader2, QrCode, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  buildChargeursPresentationModel,
  type NativeReaderProjection,
  type PaymentRail,
  type PaymentRailState,
} from "@/lib/chargeursPresentationModel";
import { stationHasPaymentTerminal } from "@/lib/kioskIdentity";

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

const READER_GRACE_MS = 10_000;
const TRANSIENT_READER_STATES = new Set(["UNAVAILABLE", "DISCOVERING", "CONNECTING", "RECONNECTING", "UPDATING"]);

const COPY = {
  fr: {
    eyebrow: "PAIEMENT SÉCURISÉ",
    ready: "Comment souhaitez-vous payer ?",
    terminal: "Sans contact",
    terminalSub: "Présentez votre carte ou votre téléphone sur le terminal",
    qr: "QR code",
    qrSub: "Scannez et payez sur votre téléphone",
    qrOnly: "Paiement par QR code",
    qrOnlySub: "Préparation du paiement sur votre téléphone…",
    checking: "Connexion au terminal…",
    checkingSub: "Nous vérifions le lecteur de cette borne avant de vous proposer le paiement.",
    slow: "Le terminal met plus de temps à se connecter. Vous pouvez réessayer ou choisir volontairement le QR code.",
    processing: "Paiement sans contact en cours",
    processingSub: "Suivez les instructions affichées sur le terminal.",
    retry: "Réessayer le lecteur",
    chooseQr: "Payer par QR code",
  },
  en: {
    eyebrow: "SECURE PAYMENT",
    ready: "How would you like to pay?",
    terminal: "Contactless",
    terminalSub: "Tap your card or phone on the payment reader",
    qr: "QR code",
    qrSub: "Scan and pay on your phone",
    qrOnly: "Pay by QR code",
    qrOnlySub: "Preparing payment on your phone…",
    checking: "Connecting payment reader…",
    checkingSub: "We are checking this kiosk reader before showing the payment options.",
    slow: "The payment reader is taking longer to connect. Retry it or explicitly choose QR payment.",
    processing: "Contactless payment in progress",
    processingSub: "Follow the instructions shown on the payment reader.",
    retry: "Retry reader",
    chooseQr: "Pay by QR code",
  },
  de: {
    eyebrow: "SICHERE ZAHLUNG",
    ready: "Wie möchten Sie bezahlen?",
    terminal: "Kontaktlos",
    terminalSub: "Karte oder Smartphone an das Terminal halten",
    qr: "QR-Code",
    qrSub: "Scannen und auf dem Smartphone bezahlen",
    qrOnly: "Per QR-Code bezahlen",
    qrOnlySub: "Zahlung auf dem Smartphone wird vorbereitet…",
    checking: "Zahlungsterminal wird verbunden…",
    checkingSub: "Das Terminal dieser Station wird geprüft, bevor die Zahlungsarten angezeigt werden.",
    slow: "Die Verbindung zum Terminal dauert länger. Versuchen Sie es erneut oder wählen Sie bewusst die QR-Zahlung.",
    processing: "Kontaktlose Zahlung läuft",
    processingSub: "Folgen Sie den Anweisungen auf dem Terminal.",
    retry: "Leser erneut verbinden",
    chooseQr: "Per QR-Code bezahlen",
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

export function KioskPaymentRailStage(props: Props) {
  const {
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
  } = props;
  const copy = COPY[lang];
  const native = (window as NativeWindow).ChargeursNative;
  const nativeBridge = Boolean(native?.getPaymentReaderStatus && native?.startTerminalPayment);
  const terminalStation = stationHasPaymentTerminal(stationId);
  const [reader, setReader] = useState<NativeReaderProjection | null>(() => parseProjection(native?.getPaymentReaderStatus?.()));
  const [localRail, setLocalRail] = useState<PaymentRail>(inProgress ? "TERMINAL" : "NONE");
  const [localRailState, setLocalRailState] = useState<PaymentRailState>(inProgress ? "ENGAGED" : "UNCLAIMED");
  const [nativeError, setNativeError] = useState<string | null>(null);
  const [readerGraceExpired, setReaderGraceExpired] = useState(!nativeBridge);
  const [readerProbeGeneration, setReaderProbeGeneration] = useState(0);
  const confirmedRef = useRef(false);
  const railTapLockRef = useRef(inProgress);
  const qrAutoStartedRef = useRef(false);

  useEffect(() => {
    if (!nativeBridge) return;
    let cancelled = false;
    const refresh = () => {
      const next = parseProjection(native?.getPaymentReaderStatus?.());
      if (!cancelled && next) setReader(next);
    };
    refresh();
    const interval = window.setInterval(refresh, inProgress ? 650 : 700);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [native, nativeBridge, inProgress]);

  useEffect(() => {
    if (!nativeBridge || inProgress) {
      setReaderGraceExpired(true);
      return;
    }
    setReaderGraceExpired(false);
    const timeout = window.setTimeout(() => setReaderGraceExpired(true), READER_GRACE_MS);
    return () => window.clearTimeout(timeout);
  }, [nativeBridge, inProgress, rentalSessionId, readerProbeGeneration]);

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

  const chooseQr = () => {
    if (railTapLockRef.current || !model.payment.canChooseQr) return;
    railTapLockRef.current = true;
    setLocalRail("QR");
    setLocalRailState("CLAIMING");
    onChooseQr();
  };

  const readerState = model.reader.state;
  const transientReader = nativeBridge
    && model.reader.capability === "QR_ONLY"
    && TRANSIENT_READER_STATES.has(readerState)
    && !inProgress;

  // DTA21269 is physically terminal-equipped. A temporary reader projection
  // must never silently convert that cabinet into QR-only. Keep the rail
  // unclaimed until the reader is READY, then present the normal Terminal + QR
  // choice. If recovery takes too long (or reports ABSENT/ERROR), allow an
  // explicit retry-or-QR decision instead of auto-starting Checkout.
  const terminalReaderUnavailable = terminalStation
    && model.reader.capability === "QR_ONLY"
    && !inProgress;
  const waitingForReader = terminalReaderUnavailable
    && nativeBridge
    && transientReader
    && !readerGraceExpired;
  const readerNeedsDecision = terminalReaderUnavailable
    && (!nativeBridge || readerGraceExpired || readerState === "ABSENT" || readerState === "ERROR");
  const confirmedQrOnly = !terminalStation && (
    !nativeBridge
    || readerState === "ABSENT"
    || readerState === "ERROR"
  );

  /*
   * Payment-rail invariant:
   * - DTA21269 never auto-claims QR: it owns the physical WisePad and must
   *   preserve the Terminal + QR choice whenever the reader becomes READY;
   * - non-terminal cabinets may auto-fallback to QR when the bridge/reader is
   *   explicitly unavailable;
   * - DISCOVERING / CONNECTING / RECONNECTING / UPDATING never claim QR merely
   *   because the bounded reader grace elapsed.
   */
  useEffect(() => {
    if (
      inProgress
      || terminalStation
      || model.reader.capability !== "QR_ONLY"
      || !confirmedQrOnly
      || !model.payment.canChooseQr
      || qrAutoStartedRef.current
    ) return;
    qrAutoStartedRef.current = true;
    railTapLockRef.current = true;
    setLocalRail("QR");
    setLocalRailState("CLAIMING");
    onChooseQr();
  }, [inProgress, terminalStation, model.reader.capability, model.payment.canChooseQr, confirmedQrOnly, onChooseQr]);

  const chooseTerminal = () => {
    if (!terminalStation) return;
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

  const retryReader = () => {
    setNativeError(null);
    setReaderGraceExpired(false);
    qrAutoStartedRef.current = false;
    setReaderProbeGeneration((generation) => generation + 1);
    const next = parseProjection(native?.refreshPaymentReader?.());
    if (next) setReader(next);
  };

  if (inProgress || model.payment.rail === "TERMINAL") {
    return <div className="kiosk-payment-rail-stage flex w-full max-w-5xl flex-col items-center gap-7 px-5 text-center" data-payment-rail="TERMINAL" data-reader-state={readerState} data-native-payment-bridge={nativeBridge ? "true" : "false"}>
      <div className="inline-flex items-center gap-2 rounded-full border border-cyan-200/20 bg-cyan-300/10 px-4 py-2 text-sm font-black tracking-[.14em] text-cyan-100"><ShieldCheck className="h-4 w-4" />{copy.eyebrow}</div>
      <CreditCard className="h-20 w-20 text-cyan-100" />
      <h2 className="font-display text-5xl font-black tracking-tight">{copy.processing}</h2>
      <p className="max-w-3xl text-xl font-medium text-muted-foreground">{copy.processingSub}</p>
      <div className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/5 px-5 py-3 text-base font-bold"><Loader2 className="h-5 w-5 animate-spin text-primary" /><span>{model.payment.serverConfirmed ? "SERVER CONFIRMED" : `${readerState} · ${model.payment.railState}`}</span></div>
    </div>;
  }

  if (waitingForReader) {
    return <div className="kiosk-payment-rail-stage flex w-full max-w-5xl flex-col items-center gap-7 px-5 text-center" data-payment-capability="READER_CONNECTING" data-reader-state={readerState} data-native-payment-bridge="true">
      <div className="inline-flex items-center gap-2 rounded-full border border-cyan-200/20 bg-cyan-300/10 px-4 py-2 text-sm font-black tracking-[.14em] text-cyan-100"><ShieldCheck className="h-4 w-4" />{copy.eyebrow}</div>
      <CreditCard className="h-20 w-20 text-cyan-100" />
      <h2 className="font-display text-5xl font-black tracking-tight">{copy.checking}</h2>
      <p className="max-w-3xl text-xl font-medium text-muted-foreground">{copy.checkingSub}</p>
      <Loader2 className="h-7 w-7 animate-spin text-primary" />
    </div>;
  }

  if (readerNeedsDecision) {
    return <div className="kiosk-payment-rail-stage flex w-full max-w-5xl flex-col items-center gap-6 px-5 text-center" data-payment-capability="READER_RETRY_OR_QR" data-reader-state={readerState} data-native-payment-bridge={nativeBridge ? "true" : "false"}>
      <div className="inline-flex items-center gap-2 rounded-full border border-cyan-200/20 bg-cyan-300/10 px-4 py-2 text-sm font-black tracking-[.14em] text-cyan-100"><ShieldCheck className="h-4 w-4" />{copy.eyebrow}</div>
      <CreditCard className="h-16 w-16 text-cyan-100" />
      <h2 className="font-display text-4xl font-black tracking-tight">{copy.checking}</h2>
      <p className="max-w-3xl text-lg font-medium text-muted-foreground">{copy.slow}</p>
      <div className="grid w-full max-w-3xl grid-cols-2 gap-4">
        <Button variant="outline" onClick={retryReader} disabled={!nativeBridge} className="h-16 gap-3 rounded-2xl text-base font-black"><RefreshCw className="h-5 w-5" />{copy.retry}</Button>
        <Button onClick={chooseQr} disabled={!model.payment.canChooseQr} className="h-16 gap-3 rounded-2xl text-base font-black"><QrCode className="h-5 w-5" />{copy.chooseQr}</Button>
      </div>
      {nativeError && <p className="text-sm font-semibold text-warning">{nativeError}</p>}
    </div>;
  }

  if (model.reader.capability === "QR_ONLY") {
    return <div className="kiosk-payment-rail-stage flex w-full max-w-5xl flex-col items-center gap-7 px-5 text-center" data-payment-capability="QR_ONLY" data-reader-state={readerState} data-native-payment-bridge={nativeBridge ? "true" : "false"}>
      <ShieldCheck className="h-8 w-8 text-primary" /><QrCode className="h-20 w-20 text-primary" />
      <h2 className="font-display text-5xl font-black tracking-tight">{copy.qrOnly}</h2>
      <p className="max-w-3xl text-xl font-medium text-muted-foreground">{copy.qrOnlySub}</p>
      <Loader2 className="h-7 w-7 animate-spin text-primary" />
      {nativeBridge && (readerState === "ERROR" || readerState === "ABSENT") && <Button variant="ghost" onClick={retryReader} className="h-12 gap-2 rounded-full px-6"><RefreshCw className="h-4 w-4" />{copy.retry}</Button>}
      {nativeError && <p className="text-sm font-semibold text-warning">{nativeError}</p>}
    </div>;
  }

  return <div className="kiosk-payment-rail-stage flex w-full max-w-6xl flex-col items-center gap-7 px-5 text-center" data-payment-capability="TERMINAL_AND_QR" data-reader-state={readerState} data-native-payment-bridge="true">
    <div className="inline-flex items-center gap-2 rounded-full border border-cyan-200/20 bg-cyan-300/10 px-4 py-2 text-sm font-black tracking-[.14em] text-cyan-100"><ShieldCheck className="h-4 w-4" />{copy.eyebrow}</div>
    <h2 className="font-display text-5xl font-black tracking-tight sm:text-6xl">{copy.ready}</h2>
    <div className="grid w-full grid-cols-2 gap-6">
      <button type="button" onClick={chooseTerminal} disabled={!terminalStation || !model.payment.canChooseTerminal} className="min-h-64 rounded-[2.25rem] border border-cyan-200/25 bg-cyan-300/[.08] p-8 text-left disabled:opacity-50"><CreditCard className="h-12 w-12 text-cyan-100" /><div className="mt-12 font-display text-3xl font-black">{copy.terminal}</div><p className="mt-3 text-lg font-medium text-muted-foreground">{copy.terminalSub}</p></button>
      <button type="button" onClick={chooseQr} disabled={!model.payment.canChooseQr} className="min-h-64 rounded-[2.25rem] border border-white/15 bg-white/[.055] p-8 text-left disabled:opacity-50"><QrCode className="h-12 w-12 text-primary" /><div className="mt-12 font-display text-3xl font-black">{copy.qr}</div><p className="mt-3 text-lg font-medium text-muted-foreground">{copy.qrSub}</p></button>
    </div>
    {nativeError && <p className="text-sm font-semibold text-warning">{nativeError}</p>}
  </div>;
}
