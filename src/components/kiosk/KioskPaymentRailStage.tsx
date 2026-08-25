import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, CreditCard, Loader2, QrCode, RefreshCw, ShieldCheck, Smartphone, X } from "lucide-react";
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
  onCancelled: () => void;
};

const READER_GRACE_MS = 10_000;
const TRANSIENT_READER_STATES = new Set(["UNAVAILABLE", "DISCOVERING", "CONNECTING", "RECONNECTING", "UPDATING"]);

const COPY = {
  fr: {
    eyebrow: "PAIEMENT SÉCURISÉ",
    ready: "Comment souhaitez-vous payer ?",
    terminal: "Sans contact",
    terminalSub: "La zone sans contact se trouve sous l’écran",
    qr: "QR code",
    qrSub: "Scannez et payez sur votre téléphone",
    qrOnly: "Paiement par QR code",
    qrOnlySub: "Préparation du paiement sur votre téléphone…",
    checking: "Connexion au terminal…",
    checkingSub: "Nous vérifions le lecteur de cette borne avant de vous proposer le paiement.",
    slow: "Le terminal met plus de temps à se connecter. Vous pouvez réessayer ou choisir volontairement le QR code.",
    processing: "Approchez votre carte ou votre téléphone",
    processingSub: "Maintenez-le sur la zone sans contact située sous l’écran jusqu’à la confirmation.",
    presentNow: "Présentez maintenant",
    terminalBelow: "ZONE SANS CONTACT SOUS L’ÉCRAN",
    contactlessLabel: "Symbole de paiement sans contact",
    cancellingTitle: "Annulation sécurisée en cours",
    cancellingSub: "Ne présentez plus votre carte. Nous confirmons l’annulation avant le retour à l’accueil.",
    cancelReturnHint: "Retour automatique à l’accueil après confirmation",
    staleQr: "Ancien paiement QR détecté",
    staleQrSub: "Ce paiement QR doit être annulé avant de démarrer le terminal sans contact.",
    retry: "Réessayer le lecteur",
    chooseQr: "Payer par QR code",
    cancel: "Annuler le paiement",
    cancelling: "Annulation…",
    cancelFailed: "Annulation impossible pour le moment. Réessayez.",
  },
  en: {
    eyebrow: "SECURE PAYMENT",
    ready: "How would you like to pay?",
    terminal: "Contactless",
    terminalSub: "The contactless area is below the screen",
    qr: "QR code",
    qrSub: "Scan and pay on your phone",
    qrOnly: "Pay by QR code",
    qrOnlySub: "Preparing payment on your phone…",
    checking: "Connecting payment reader…",
    checkingSub: "We are checking this kiosk reader before showing the payment options.",
    slow: "The payment reader is taking longer to connect. Retry it or explicitly choose QR payment.",
    processing: "Hold your card or phone near the reader",
    processingSub: "Keep it on the contactless area below the screen until confirmation.",
    presentNow: "Present it now",
    terminalBelow: "CONTACTLESS AREA BELOW THE SCREEN",
    contactlessLabel: "Contactless payment symbol",
    cancellingTitle: "Secure cancellation in progress",
    cancellingSub: "Remove your card or phone. We are confirming cancellation before returning home.",
    cancelReturnHint: "Automatic return home after confirmation",
    staleQr: "Previous QR payment detected",
    staleQrSub: "That QR payment must be cancelled before starting contactless payment.",
    retry: "Retry reader",
    chooseQr: "Pay by QR code",
    cancel: "Cancel payment",
    cancelling: "Cancelling…",
    cancelFailed: "Unable to cancel right now. Please try again.",
  },
  de: {
    eyebrow: "SICHERE ZAHLUNG",
    ready: "Wie möchten Sie bezahlen?",
    terminal: "Kontaktlos",
    terminalSub: "Die Kontaktlos-Zone befindet sich unter dem Bildschirm",
    qr: "QR-Code",
    qrSub: "Scannen und auf dem Smartphone bezahlen",
    qrOnly: "Per QR-Code bezahlen",
    qrOnlySub: "Zahlung auf dem Smartphone wird vorbereitet…",
    checking: "Zahlungsterminal wird verbunden…",
    checkingSub: "Das Terminal dieser Station wird geprüft, bevor die Zahlungsarten angezeigt werden.",
    slow: "Die Verbindung zum Terminal dauert länger. Versuchen Sie es erneut oder wählen Sie bewusst den QR-Code.",
    processing: "Karte oder Smartphone anhalten",
    processingSub: "Halten Sie es bis zur Bestätigung an die Kontaktlos-Zone unter dem Bildschirm.",
    presentNow: "Jetzt vorhalten",
    terminalBelow: "KONTAKTLOS-ZONE UNTER DEM BILDSCHIRM",
    contactlessLabel: "Symbol für kontaktloses Bezahlen",
    cancellingTitle: "Sicherer Abbruch läuft",
    cancellingSub: "Karte oder Smartphone entfernen. Wir bestätigen den Abbruch vor der Rückkehr zum Start.",
    cancelReturnHint: "Automatische Rückkehr nach der Bestätigung",
    staleQr: "Vorherige QR-Zahlung erkannt",
    staleQrSub: "Die QR-Zahlung muss abgebrochen werden, bevor kontaktlos bezahlt werden kann.",
    retry: "Leser erneut verbinden",
    chooseQr: "Per QR-Code bezahlen",
    cancel: "Zahlung abbrechen",
    cancelling: "Abbruch…",
    cancelFailed: "Abbruch derzeit nicht möglich. Bitte erneut versuchen.",
  },
} as const;

type PaymentCopy = (typeof COPY)[keyof typeof COPY];

function ContactlessSymbol({
  label,
  className = "h-20 w-20",
}: {
  label: string;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 64 64"
      role="img"
      aria-label={label}
      className={className}
      fill="none"
    >
      <circle cx="10" cy="32" r="3.5" fill="currentColor" />
      <path d="M18 45c7-7.2 7-18.8 0-26" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
      <path d="M30 51c11-10.8 11-27.2 0-38" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
      <path d="M43 57c15-14.6 15-35.4 0-50" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}

function TerminalPlacementGuide({
  copy,
  cancelling,
}: {
  copy: PaymentCopy;
  cancelling: boolean;
}) {
  return (
    <div className="flex w-full max-w-4xl flex-col items-center gap-2" aria-hidden={cancelling}>
      <div className="relative flex h-36 w-full items-center justify-center gap-5">
        <span className="absolute h-32 w-72 rounded-full bg-cyan-300/15 blur-3xl" />
        <div className="relative grid h-24 w-36 place-items-center rounded-[1.6rem] border border-cyan-100/25 bg-cyan-300/[.08] shadow-[0_0_36px_rgba(34,211,238,.14)]">
          <CreditCard className="h-14 w-14 text-cyan-100" aria-hidden />
        </div>
        <div className="relative grid h-32 w-32 place-items-center rounded-full border border-cyan-100/35 bg-cyan-300/[.12] text-cyan-100 shadow-[0_0_48px_rgba(34,211,238,.28)]">
          <span className="absolute inset-2 rounded-full border border-cyan-100/20 motion-safe:animate-ping" />
          <ContactlessSymbol label={copy.contactlessLabel} className="relative h-20 w-20" />
        </div>
        <div className="relative grid h-24 w-24 place-items-center rounded-[1.6rem] border border-violet-200/25 bg-violet-300/[.08] shadow-[0_0_36px_rgba(167,139,250,.14)]">
          <Smartphone className="h-14 w-14 text-violet-100" aria-hidden />
        </div>
      </div>
      <div className="flex flex-col items-center text-cyan-100">
        <ArrowDown className="h-11 w-11 motion-safe:animate-bounce" aria-hidden />
        <span className="rounded-full border border-cyan-100/25 bg-cyan-300/[.09] px-6 py-2 text-base font-black tracking-[.13em]">
          {copy.terminalBelow}
        </span>
      </div>
    </div>
  );
}

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
    onCancelled,
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
  // A WisePad cancellation may remain projected for a brief moment after the
  // kiosk has already returned home. Never let that stale terminal state close
  // a newly-created rental before this exact screen has started a payment.
  const terminalStartAcceptedRef = useRef(false);
  const terminalRailObservedRef = useRef(false);
  const railTapLockRef = useRef(inProgress);
  const qrAutoStartedRef = useRef(false);
  const initialReaderProbeRef = useRef<string | null>(null);

  useEffect(() => {
    terminalCancellationHandledRef.current = false;
    terminalStartAcceptedRef.current = false;
    terminalRailObservedRef.current = false;
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
    const payment = reader?.payment;
    const currentTerminalRail = payment?.rail === "TERMINAL"
      && payment?.railState !== "CANCELLED"
      && payment?.railState !== "EXPIRED";

    // The native shell may carry a prior rental's final CANCELLED projection
    // across Home and into the next payment screen. A current session must
    // first be visibly engaged on the native Terminal rail before its own
    // cancellation is allowed to return the kiosk home.
    if (terminalStartAcceptedRef.current && currentTerminalRail) {
      terminalRailObservedRef.current = true;
    }

    if (
      terminalCancellationHandledRef.current
      || !terminalStartAcceptedRef.current
      || !terminalRailObservedRef.current
      || !isCanonicalTerminalCancellation(reader)
    ) return;
    terminalCancellationHandledRef.current = true;
    railTapLockRef.current = false;
    setCancellingPayment(false);
    setCancelError(null);
    setLocalRail("NONE");
    setLocalRailState(reader?.payment?.railState === "EXPIRED" ? "EXPIRED" : "CANCELLED");
    onCancelled();
  }, [reader, onCancelled]);

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
    terminalStartAcceptedRef.current = true;
    setLocalRailState("ENGAGED");
    onTerminalEngaged();
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
      setLocalRail("NONE");
      setLocalRailState("CANCELLED");
      onCancelled();
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
    const cancellationRequested = cancellingPayment
      || localRailState === "CANCELLING"
      || model.payment.railState === "CANCELLING";
    const title = staleQrConflict
      ? copy.staleQr
      : cancellationRequested
        ? copy.cancellingTitle
        : copy.processing;
    const subtitle = staleQrConflict
      ? copy.staleQrSub
      : cancellationRequested
        ? copy.cancellingSub
        : copy.processingSub;

    return <div
      className="kiosk-payment-rail-stage flex w-full max-w-6xl flex-col items-center gap-4 px-6 text-center"
      data-payment-rail={staleQrConflict ? "QR_CONFLICT" : "TERMINAL"}
      data-reader-state={readerState}
      data-native-payment-bridge={nativeBridge ? "true" : "false"}
      aria-live="polite"
    >
      <div className="inline-flex items-center gap-2 rounded-full border border-cyan-200/20 bg-cyan-300/10 px-4 py-2 text-sm font-black tracking-[.14em] text-cyan-100">
        <ShieldCheck className="h-4 w-4" aria-hidden />
        {copy.eyebrow}
      </div>

      {staleQrConflict
        ? <QrCode className="h-20 w-20 text-primary" aria-hidden />
        : cancellationRequested
          ? <div className="grid h-28 w-28 place-items-center rounded-full border border-cyan-100/25 bg-cyan-300/10 shadow-[0_0_42px_rgba(34,211,238,.2)]"><Loader2 className="h-14 w-14 animate-spin text-cyan-100" aria-hidden /></div>
          : <TerminalPlacementGuide copy={copy} cancelling={false} />}

      <h2 className="font-display text-5xl font-black leading-[.96] tracking-tight">{title}</h2>
      <p className="max-w-4xl text-2xl font-semibold leading-snug text-slate-200/80">{subtitle}</p>

      {!staleQrConflict && !cancellationRequested && (
        <div className="inline-flex items-center gap-3 rounded-full border border-emerald-200/20 bg-emerald-300/[.08] px-6 py-3 text-lg font-black text-emerald-200">
          <span className="h-3 w-3 animate-pulse rounded-full bg-emerald-300 shadow-[0_0_14px_rgba(110,231,183,.9)]" />
          {copy.presentNow}
        </div>
      )}

      <Button
        variant="outline"
        onClick={() => void cancelActivePayment()}
        disabled={cancellingPayment}
        className="h-14 gap-3 rounded-full px-9 text-lg font-black"
      >
        {cancellingPayment ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <X className="h-5 w-5" aria-hidden />}
        {cancellingPayment ? copy.cancelling : copy.cancel}
      </Button>

      <p className="text-sm font-semibold text-cyan-100/65">{copy.cancelReturnHint}</p>
      {cancelError && <p role="alert" className="text-sm font-semibold text-warning">{copy.cancelFailed} <span className="font-mono text-xs">{cancelError}</span></p>}
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
      <button type="button" onClick={chooseTerminal} disabled={!terminalStation || !model.payment.canChooseTerminal} className="min-h-64 rounded-[2.25rem] border border-cyan-200/25 bg-cyan-300/[.08] p-8 text-left disabled:opacity-50"><ContactlessSymbol label={copy.contactlessLabel} className="h-14 w-14 text-cyan-100" /><div className="mt-10 font-display text-3xl font-black">{copy.terminal}</div><p className="mt-3 text-lg font-medium text-muted-foreground">{copy.terminalSub}</p></button>
      <button type="button" onClick={chooseQr} disabled={!model.payment.canChooseQr} className="min-h-64 rounded-[2.25rem] border border-white/15 bg-white/[.055] p-8 text-left disabled:opacity-50"><QrCode className="h-12 w-12 text-primary" /><div className="mt-12 font-display text-3xl font-black">{copy.qr}</div><p className="mt-3 text-lg font-medium text-muted-foreground">{copy.qrSub}</p></button>
    </div>
    {nativeError && <p className="text-sm font-semibold text-warning">{nativeError}</p>}
  </div>;
}
