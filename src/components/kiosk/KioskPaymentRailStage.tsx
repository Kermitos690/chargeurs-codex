import { useEffect, useMemo, useRef, useState } from "react";
import { CreditCard, Loader2, QrCode, RefreshCw, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  buildChargeursPresentationModel,
  type NativeReaderProjection,
  type PaymentRail,
  type PaymentRailState,
} from "@/lib/chargeursPresentationModel";
import { stationHasPaymentTerminal } from "@/lib/kioskIdentity";
import { readKioskToken } from "@/lib/kioskFetch";

type NativeTerminalBridge = {
  getPaymentReaderStatus?: () => string;
  refreshPaymentReader?: () => string;
  startTerminalPayment?: (rentalSessionId: string) => string;
  cancelTerminalPayment?: () => string;
  restartApp?: () => void;
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
    staleQr: "Ancien paiement QR détecté",
    staleQrSub: "Ce paiement QR doit être annulé avant de démarrer le terminal sans contact.",
    retry: "Réessayer le lecteur",
    chooseQr: "Payer par QR code",
    cancel: "Annuler",
    cancelling: "Annulation…",
    cancelFailed: "Annulation impossible pour le moment. Réessayez.",
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
    staleQr: "Previous QR payment detected",
    staleQrSub: "That QR payment must be cancelled before starting contactless payment.",
    retry: "Retry reader",
    chooseQr: "Pay by QR code",
    cancel: "Cancel",
    cancelling: "Cancelling…",
    cancelFailed: "Unable to cancel right now. Please try again.",
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
    slow: "Die Verbindung zum Terminal dauert länger. Versuchen Sie es erneut oder wählen Sie bewusst den QR-Code.",
    processing: "Kontaktlose Zahlung läuft",
    processingSub: "Folgen Sie den Anweisungen auf dem Terminal.",
    staleQr: "Vorherige QR-Zahlung erkannt",
    staleQrSub: "Die QR-Zahlung muss abgebrochen werden, bevor kontaktlos bezahlt werden kann.",
    retry: "Leser erneut verbinden",
    chooseQr: "Per QR-Code bezahlen",
    cancel: "Abbrechen",
    cancelling: "Abbruch…",
    cancelFailed: "Abbruch derzeit nicht möglich. Bitte erneut versuchen.",
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

function isCanonicalTerminalCancellation(reader: NativeReaderProjection | null): boolean {
  const payment = reader?.payment;
  if (!payment) return false;

  const cancelled = (payment.railState === "CANCELLED" || payment.railState === "EXPIRED")
    && payment.serverConfirmed !== true
    && payment.recoveryRequired !== true;
  if (!cancelled) return false;

  // Canonical current runtime releases the rail to NONE. Older/native-lagging
  // projections can briefly keep TERMINAL while the WisePad itself has already
  // returned READY with a final CANCELLED/EXPIRED state. That is still a safe,
  // terminal-side final cancellation and must release the kiosk UI instead of
  // leaving a stale Cancel button on screen.
  return payment.rail === "NONE"
    || (payment.rail === "TERMINAL" && reader?.readerState === "READY");
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
  // Cabinet identity is the physical source of truth. A native bridge on a QR-only
  // tablet is not evidence of a payment reader; it must never create a disabled
  // “Sans contact” choice for the customer. This remains true after a production redeploy.
  const physicalQrOnlyCabinet = !terminalStation;
  const [reader, setReader] = useState<NativeReaderProjection | null>(() => parseProjection(native?.getPaymentReaderStatus?.()));
  const [localRail, setLocalRail] = useState<PaymentRail>(inProgress ? "TERMINAL" : "NONE");
  const [localRailState, setLocalRailState] = useState<PaymentRailState>(inProgress ? "ENGAGED" : "UNCLAIMED");
  const [nativeError, setNativeError] = useState<string | null>(null);
  const [readerGraceExpired, setReaderGraceExpired] = useState(!nativeBridge);
  const [readerProbeGeneration, setReaderProbeGeneration] = useState(0);
  const [cancellingPayment, setCancellingPayment] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const confirmedRef = useRef(false);
  const terminalCancellationHandledRef = useRef(false);
  const railTapLockRef = useRef(inProgress);
  const qrAutoStartedRef = useRef(false);
  const initialReaderProbeRef = useRef<string | null>(null);

  useEffect(() => {
    terminalCancellationHandledRef.current = false;
  }, [rentalSessionId]);

  useEffect(() => {
    if (!nativeBridge) return;
    let cancelled = false;
    const refresh = () => {
      const next = parseProjection(native?.getPaymentReaderStatus?.());
      if (!cancelled && next) setReader(next);
    };
    refresh();
    const interval = window.setInterval(refresh, inProgress ? 350 : 700);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [native, nativeBridge, inProgress]);

  /*
   * DTA21269 currently runs the older 1.0.35 native shell. On that build an
   * already connected WisePad can briefly project ABSENT before the USB reader
   * lifecycle is re-probed. Do one non-financial refresh per rental session
   * before treating that snapshot as a definitive physical absence.
   */
  useEffect(() => {
    if (!terminalStation || !nativeBridge || inProgress || !native?.refreshPaymentReader) return;
    if (initialReaderProbeRef.current === rentalSessionId) return;

    const currentState = typeof reader?.readerState === "string" ? reader.readerState : "UNAVAILABLE";
    initialReaderProbeRef.current = rentalSessionId;
    if (currentState === "READY" || currentState === "BUSY") return;

    setReaderGraceExpired(false);
    qrAutoStartedRef.current = false;
    setReaderProbeGeneration((generation) => generation + 1);
    try {
      const next = parseProjection(native.refreshPaymentReader());
      if (next) setReader(next);
    } catch {
      // Polling below remains the source of truth. A refresh bridge failure must
      // not claim Terminal availability and must not affect rental/payment state.
    }
  }, [terminalStation, nativeBridge, inProgress, native, rentalSessionId, reader?.readerState]);

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
    if (terminalCancellationHandledRef.current || !isCanonicalTerminalCancellation(reader)) return;
    terminalCancellationHandledRef.current = true;
    railTapLockRef.current = false;
    setCancellingPayment(false);
    setCancelError(null);
    setLocalRail("NONE");
    setLocalRailState(reader?.payment?.railState === "EXPIRED" ? "EXPIRED" : "CANCELLED");
    window.dispatchEvent(new CustomEvent("chargeurs:kiosk-return-home"));
  }, [reader]);

  const chooseQr = () => {
    if (railTapLockRef.current || !model.payment.canChooseQr) return;
    railTapLockRef.current = true;
    setLocalRail("QR");
    setLocalRailState("CLAIMING");
    onChooseQr();
  };

  const readerState = model.reader.state;
  const rawNativeRail = reader?.payment?.rail === "QR"
    ? "QR"
    : reader?.payment?.rail === "TERMINAL"
      ? "TERMINAL"
      : "NONE";
  const transientReader = nativeBridge
    && model.reader.capability === "QR_ONLY"
    && TRANSIENT_READER_STATES.has(readerState)
    && !inProgress;
  const explicitlyUnavailableReader = readerState === "ABSENT" || readerState === "ERROR";
  const readerConfirmedUnavailable = explicitlyUnavailableReader && readerGraceExpired;

  const terminalReaderUnavailable = terminalStation
    && model.reader.capability === "QR_ONLY"
    && !inProgress;
  const waitingForReader = terminalReaderUnavailable
    && nativeBridge
    && !readerGraceExpired
    && (transientReader || explicitlyUnavailableReader);
  const readerNeedsDecision = terminalReaderUnavailable
    && nativeBridge
    && !readerConfirmedUnavailable
    && readerGraceExpired;
  const confirmedQrOnly = physicalQrOnlyCabinet || (model.reader.capability === "QR_ONLY" && (
    !nativeBridge
    || readerConfirmedUnavailable
  ));

  /*
   * Payment-rail invariant:
   * - READY => Terminal + QR on the terminal-equipped cabinet;
   * - a terminal-equipped cabinet with a native bridge gets one bounded reader
   *   probe window, even if its first snapshot is ABSENT/ERROR;
   * - only a still-ABSENT/ERROR reader after that window may auto-fallback to QR;
   * - no native bridge => direct QR fallback;
   * - transient discovery/connect/reconnect/update gets the same bounded window,
   *   then an explicit Retry + QR choice without silently claiming a rail.
   */
  useEffect(() => {
    if (
      inProgress
      || (!physicalQrOnlyCabinet && model.reader.capability !== "QR_ONLY")
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
    if (!terminalStation) return;
    if (railTapLockRef.current || !model.payment.canChooseTerminal || !native?.startTerminalPayment) return;
    terminalCancellationHandledRef.current = false;
    railTapLockRef.current = true;
    setNativeError(null);
    setCancelError(null);
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

  const restartCleanly = () => {
    try {
      if (native?.restartApp) {
        native.restartApp();
        return;
      }
    } catch {
      // Browser fallback below.
    }
    window.location.reload();
  };

  const cancelActivePayment = async () => {
    if (cancellingPayment) return;
    setCancellingPayment(true);
    setCancelError(null);
    let keepCancelling = false;

    try {
      // New native APK path: stop Stripe collection on the WisePad first, then
      // let the runtime perform the same authoritative backend cancellation.
      // Polling below keeps the kiosk on CANCELLING until the server rail is
      // actually released, so screen and reader cannot diverge.
      if (rawNativeRail !== "QR" && native?.cancelTerminalPayment) {
        const ack = JSON.parse(native.cancelTerminalPayment()) as { ok?: boolean; code?: string };
        if (ack?.ok === true || ack?.code === "TERMINAL_CANCEL_IN_PROGRESS") {
          keepCancelling = true;
          setLocalRail("TERMINAL");
          setLocalRailState("CANCELLING");
          return;
        }
        setCancelError(ack?.code ?? "TERMINAL_CANCEL_FAILED");
        return;
      }

      // Backward-compatible fallback for the currently installed 1.0.35 APK,
      // which does not expose cancelTerminalPayment(). This is retained only so
      // a stale QR rail or older native shell can still be released safely.
      const kioskToken = readKioskToken();
      if (!kioskToken) {
        setCancelError("KIOSK_AUTH_REQUIRED");
        return;
      }
      const staleQrRail = rawNativeRail === "QR";
      const path = staleQrRail ? "/api/kiosk/cancel-checkout" : "/api/kiosk/terminal-payment";
      const body = staleQrRail
        ? { rentalSessionId }
        : { action: "cancel_payment_intent", rentalSessionId };
      const response = await fetch(path, {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "X-Kiosk-Token": kioskToken,
        },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      const noTerminalRail = !staleQrRail
        && response.status === 409
        && data?.error === "TERMINAL_RAIL_NOT_ENGAGED";
      if (!response.ok && !noTerminalRail) {
        setCancelError(data?.error ?? "PAYMENT_CANCEL_FAILED");
        return;
      }
      restartCleanly();
    } catch {
      setCancelError("PAYMENT_CANCEL_NETWORK_FAILED");
    } finally {
      if (!keepCancelling) setCancellingPayment(false);
    }
  };

  const retryReader = () => {
    setNativeError(null);
    setCancelError(null);
    setReaderGraceExpired(false);
    qrAutoStartedRef.current = false;
    setReaderProbeGeneration((generation) => generation + 1);
    const next = parseProjection(native?.refreshPaymentReader?.());
    if (next) setReader(next);
  };

  if (inProgress || model.payment.rail === "TERMINAL") {
    const staleQrConflict = rawNativeRail === "QR";
    return <div className="kiosk-payment-rail-stage flex w-full max-w-5xl flex-col items-center gap-7 px-5 text-center" data-payment-rail={staleQrConflict ? "QR_CONFLICT" : "TERMINAL"} data-reader-state={readerState} data-native-payment-bridge={nativeBridge ? "true" : "false"}>
      <div className="inline-flex items-center gap-2 rounded-full border border-cyan-200/20 bg-cyan-300/10 px-4 py-2 text-sm font-black tracking-[.14em] text-cyan-100"><ShieldCheck className="h-4 w-4" />{copy.eyebrow}</div>
      {staleQrConflict ? <QrCode className="h-20 w-20 text-primary" /> : <CreditCard className="h-20 w-20 text-cyan-100" />}
      <h2 className="font-display text-5xl font-black tracking-tight">{staleQrConflict ? copy.staleQr : copy.processing}</h2>
      <p className="max-w-3xl text-xl font-medium text-muted-foreground">{staleQrConflict ? copy.staleQrSub : copy.processingSub}</p>
      <div className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/5 px-5 py-3 text-base font-bold"><Loader2 className="h-5 w-5 animate-spin text-primary" /><span>{model.payment.serverConfirmed ? "SERVER CONFIRMED" : `${readerState} · ${model.payment.railState}`}</span></div>
      <Button variant="outline" onClick={() => void cancelActivePayment()} disabled={cancellingPayment} className="h-14 gap-3 rounded-full px-8 text-base font-black">
        {cancellingPayment ? <Loader2 className="h-5 w-5 animate-spin" /> : <X className="h-5 w-5" />}
        {cancellingPayment ? copy.cancelling : copy.cancel}
      </Button>
      {cancelError && <p className="text-sm font-semibold text-warning">{copy.cancelFailed} <span className="font-mono text-xs">{cancelError}</span></p>}
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

  if (physicalQrOnlyCabinet || model.reader.capability === "QR_ONLY") {
    return <div className="kiosk-payment-rail-stage flex w-full max-w-5xl flex-col items-center gap-7 px-5 text-center" data-payment-capability="QR_ONLY" data-reader-state={readerState} data-native-payment-bridge={nativeBridge ? "true" : "false"}>
      <ShieldCheck className="h-8 w-8 text-primary" /><QrCode className="h-20 w-20 text-primary" />
      <h2 className="font-display text-5xl font-black tracking-tight">{copy.qrOnly}</h2>
      <p className="max-w-3xl text-xl font-medium text-muted-foreground">{copy.qrOnlySub}</p>
      <Loader2 className="h-7 w-7 animate-spin text-primary" />
      {terminalStation && nativeBridge && (readerState === "ERROR" || readerState === "ABSENT") && <Button variant="ghost" onClick={retryReader} className="h-12 gap-2 rounded-full px-6"><RefreshCw className="h-4 w-4" />{copy.retry}</Button>}
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
