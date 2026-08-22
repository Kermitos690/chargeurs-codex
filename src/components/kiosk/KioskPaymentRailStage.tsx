import { useEffect, useMemo, useRef, useState } from "react";
import { CreditCard, Loader2, QrCode, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  buildChargeursPresentationModel,
  type NativeReaderProjection,
  type PaymentRail,
  type PaymentRailState,
} from "@/lib/chargeursPresentationModel";
import { shouldLeaveTerminalPaymentStage } from "@/lib/kioskTerminalCancellation";

type NativeTerminalBridge = {
  getPaymentReaderStatus?: () => string;
  refreshPaymentReader?: () => string;
  startTerminalPayment?: (rentalSessionId: string) => string;
  cancelTerminalPayment?: () => string;
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
  pricingDepositCents?: number;
  pricingTotalCapCents?: number;
  inProgress?: boolean;
  onChooseQr: () => void;
  onTerminalEngaged: () => void;
  onServerConfirmed: () => void;
  onTerminalCancelled: () => void;
};

const READER_GRACE_MS = 10_000;
const TRANSIENT_READER_STATES = new Set(["UNAVAILABLE", "DISCOVERING", "CONNECTING", "RECONNECTING", "UPDATING"]);

const COPY = {
  fr: {
    eyebrow: "PAIEMENT SÉCURISÉ",
    ready: "Comment souhaitez-vous payer ?",
    reservedSlot: (slot: number) => `Batterie réservée : slot ${slot}`,
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
    processingSub: "Suivez les instructions affichées sur le terminal. N’approchez pas votre carte si le montant ne correspond pas à la garantie annoncée.",
    awaitingCard: "Lecteur prêt · présentez votre carte ou téléphone",
    guarantee: (amount: string) => `Garantie temporaire et montant maximal de location : ${amount}. Seul le prix final est capturé au retour.`,
    cancel: "Annuler la demande",
    cancelling: "Annulation sécurisée…",
    retry: "Réessayer le lecteur",
    chooseQr: "Payer par QR code",
  },
  en: {
    eyebrow: "SECURE PAYMENT",
    ready: "How would you like to pay?",
    reservedSlot: (slot: number) => `Reserved battery: slot ${slot}`,
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
    processingSub: "Follow the instructions shown on the payment reader. Do not tap your card if the amount does not match the stated guarantee.",
    awaitingCard: "Reader ready · tap your card or phone",
    guarantee: (amount: string) => `Temporary guarantee and maximum rental amount: ${amount}. Only the final rental price is captured on return.`,
    cancel: "Cancel request",
    cancelling: "Cancelling safely…",
    retry: "Retry reader",
    chooseQr: "Pay by QR code",
  },
  de: {
    eyebrow: "SICHERE ZAHLUNG",
    ready: "Wie möchten Sie bezahlen?",
    reservedSlot: (slot: number) => `Reservierte Batterie: Fach ${slot}`,
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
    processingSub: "Folgen Sie den Anweisungen auf dem Terminal. Halten Sie keine Karte vor, wenn der Betrag nicht der angekündigten Garantie entspricht.",
    awaitingCard: "Leser bereit · Karte oder Smartphone vorhalten",
    guarantee: (amount: string) => `Vorübergehende Garantie und maximaler Mietbetrag: ${amount}. Bei Rückgabe wird nur der tatsächliche Mietpreis eingezogen.`,
    cancel: "Anfrage abbrechen",
    cancelling: "Sichere Stornierung…",
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
    pricingDepositCents,
    pricingTotalCapCents,
    inProgress = false,
    onChooseQr,
    onTerminalEngaged,
    onServerConfirmed,
    onTerminalCancelled,
  } = props;
  const copy = COPY[lang];
  const native = (window as NativeWindow).ChargeursNative;
  const nativeBridge = Boolean(native?.getPaymentReaderStatus && native?.startTerminalPayment);
  const [reader, setReader] = useState<NativeReaderProjection | null>(() => parseProjection(native?.getPaymentReaderStatus?.()));
  const [localRail, setLocalRail] = useState<PaymentRail>(inProgress ? "TERMINAL" : "NONE");
  const [localRailState, setLocalRailState] = useState<PaymentRailState>(inProgress ? "ENGAGED" : "UNCLAIMED");
  const [nativeError, setNativeError] = useState<string | null>(null);
  const [readerGraceExpired, setReaderGraceExpired] = useState(!nativeBridge);
  const [readerProbeGeneration, setReaderProbeGeneration] = useState(0);
  const [terminalCancelRequested, setTerminalCancelRequested] = useState(false);
  const [terminalCancelError, setTerminalCancelError] = useState<string | null>(null);
  const confirmedRef = useRef(false);
  const terminalCancellationHandledRef = useRef(false);
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

  useEffect(() => {
    if (!shouldLeaveTerminalPaymentStage(reader, terminalCancellationHandledRef.current)) return;
    terminalCancellationHandledRef.current = true;
    // Do not retain the local TERMINAL/ENGAGED placeholder once the native
    // bridge has received the server's authoritative cancellation result.
    setLocalRail("NONE");
    setLocalRailState(reader?.payment.railState === "EXPIRED" ? "EXPIRED" : "CANCELLED");
    onTerminalCancelled();
  }, [reader, onTerminalCancelled]);

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
  const waitingForReader = transientReader && !readerGraceExpired;
  const readerNeedsDecision = transientReader && readerGraceExpired;
  const confirmedQrOnly = !nativeBridge
    || readerState === "ABSENT"
    || readerState === "ERROR";

  /*
   * Payment-rail invariant:
   * - only an absent bridge or an explicitly ABSENT/ERROR reader may trigger
   *   automatic QR fallback;
   * - DISCOVERING / CONNECTING / RECONNECTING / UPDATING never claim QR merely
   *   because the bounded reader grace elapsed;
   * - after the grace window, the customer receives an explicit choice to retry
   *   the reader or intentionally choose QR. This leaves the rental rail
   *   UNCLAIMED while the physical WisePad is still recovering.
   */
  useEffect(() => {
    if (
      inProgress
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
  }, [inProgress, model.reader.capability, model.payment.canChooseQr, confirmedQrOnly, onChooseQr]);

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

  const retryReader = () => {
    setNativeError(null);
    setReaderGraceExpired(false);
    qrAutoStartedRef.current = false;
    setReaderProbeGeneration((generation) => generation + 1);
    const next = parseProjection(native?.refreshPaymentReader?.());
    if (next) setReader(next);
  };

  const cancelTerminal = () => {
    if (terminalCancelRequested || !native?.cancelTerminalPayment) return;
    setTerminalCancelError(null);
    try {
      const ack = JSON.parse(native.cancelTerminalPayment()) as { ok?: boolean; code?: string };
      if (ack?.ok === true) {
        setTerminalCancelRequested(true);
        return;
      }
      setTerminalCancelError(ack?.code ?? "TERMINAL_CANCEL_FAILED");
    } catch {
      setTerminalCancelError("TERMINAL_CANCEL_FAILED");
    }
  };

  const money = (amount: number | undefined) => Number.isInteger(amount) && Number(amount) > 0
    ? `${(Number(amount) / 100).toFixed(2)} ${(pricingCurrency ?? "CHF").toUpperCase()}`
    : null;
  const guarantee = money(pricingDepositCents);
  const cap = money(pricingTotalCapCents);
  const terminalAwaitingCard = !terminalCancelRequested
    && model.payment.rail === "TERMINAL"
    && ["CLAIMING", "ENGAGED", "PROCESSING"].includes(model.payment.railState)
    && !model.payment.serverConfirmed;

  if (inProgress || model.payment.rail === "TERMINAL") {
    return <div className="kiosk-payment-rail-stage flex w-full max-w-5xl flex-col items-center gap-7 px-5 text-center" data-payment-rail="TERMINAL" data-reader-state={readerState} data-native-payment-bridge={nativeBridge ? "true" : "false"}>
      <div className="inline-flex items-center gap-2 rounded-full border border-cyan-200/20 bg-cyan-300/10 px-4 py-2 text-sm font-black tracking-[.14em] text-cyan-100"><ShieldCheck className="h-4 w-4" />{copy.eyebrow}</div>
      <CreditCard className="h-20 w-20 text-cyan-100" />
      <h2 className="font-display text-5xl font-black tracking-tight">{copy.processing}</h2>
      <p className="max-w-3xl text-xl font-medium text-muted-foreground">{copy.processingSub}</p>
      {selectedSlot != null && <p className="text-lg font-bold text-cyan-100">{copy.reservedSlot(selectedSlot)}</p>}
      {guarantee && cap && <p className="max-w-3xl rounded-2xl border border-cyan-200/20 bg-cyan-300/[.08] px-5 py-4 text-base font-semibold text-cyan-50">{copy.guarantee(guarantee)}</p>}
      <div className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/5 px-5 py-3 text-base font-bold"><Loader2 className="h-5 w-5 animate-spin text-primary" /><span>{model.payment.serverConfirmed ? "SERVER CONFIRMED" : terminalCancelRequested ? copy.cancelling : terminalAwaitingCard ? copy.awaitingCard : `${readerState} · ${model.payment.railState}`}</span></div>
      {!model.payment.serverConfirmed && native?.cancelTerminalPayment && <Button variant="outline" onClick={cancelTerminal} disabled={terminalCancelRequested} className="h-14 rounded-full px-7 text-base font-bold">{terminalCancelRequested ? copy.cancelling : copy.cancel}</Button>}
      {(terminalCancelError || (terminalCancelRequested && model.journey.state === "RECOVERY")) && <p className="text-sm font-semibold text-warning">{terminalCancelError ?? "PAYMENT_RECONCILIATION_REQUIRED"}</p>}
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
    return <div className="kiosk-payment-rail-stage flex w-full max-w-5xl flex-col items-center gap-6 px-5 text-center" data-payment-capability="READER_RETRY_OR_QR" data-reader-state={readerState} data-native-payment-bridge="true">
      <div className="inline-flex items-center gap-2 rounded-full border border-cyan-200/20 bg-cyan-300/10 px-4 py-2 text-sm font-black tracking-[.14em] text-cyan-100"><ShieldCheck className="h-4 w-4" />{copy.eyebrow}</div>
      <CreditCard className="h-16 w-16 text-cyan-100" />
      <h2 className="font-display text-4xl font-black tracking-tight">{copy.checking}</h2>
      <p className="max-w-3xl text-lg font-medium text-muted-foreground">{copy.slow}</p>
      <div className="grid w-full max-w-3xl grid-cols-2 gap-4">
        <Button variant="outline" onClick={retryReader} className="h-16 gap-3 rounded-2xl text-base font-black"><RefreshCw className="h-5 w-5" />{copy.retry}</Button>
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
    {selectedSlot != null && <p className="text-lg font-bold text-cyan-100">{copy.reservedSlot(selectedSlot)}</p>}
    {guarantee && cap && <p className="max-w-3xl rounded-2xl border border-cyan-200/20 bg-cyan-300/[.08] px-5 py-4 text-base font-semibold text-cyan-50">{copy.guarantee(guarantee)}</p>}
    <div className="grid w-full grid-cols-2 gap-6">
      <button type="button" onClick={chooseTerminal} disabled={!model.payment.canChooseTerminal} className="min-h-64 rounded-[2.25rem] border border-cyan-200/25 bg-cyan-300/[.08] p-8 text-left disabled:opacity-50"><CreditCard className="h-12 w-12 text-cyan-100" /><div className="mt-12 font-display text-3xl font-black">{copy.terminal}</div><p className="mt-3 text-lg font-medium text-muted-foreground">{copy.terminalSub}</p></button>
      <button type="button" onClick={chooseQr} disabled={!model.payment.canChooseQr} className="min-h-64 rounded-[2.25rem] border border-white/15 bg-white/[.055] p-8 text-left disabled:opacity-50"><QrCode className="h-12 w-12 text-primary" /><div className="mt-12 font-display text-3xl font-black">{copy.qr}</div><p className="mt-3 text-lg font-medium text-muted-foreground">{copy.qrSub}</p></button>
    </div>
    {nativeError && <p className="text-sm font-semibold text-warning">{nativeError}</p>}
  </div>;
}
