export type ChargeursJourneyState =
  | "BOOTING"
  | "AUTH_REQUIRED"
  | "HOME"
  | "MEMBER_CONNECT"
  | "SELECTION"
  | "PRICING"
  | "PAYMENT_READY"
  | "PAYMENT_IN_PROGRESS"
  | "PAYMENT_CONFIRMED"
  | "HARDWARE_WAIT"
  | "RELEASE_CONFIRMED"
  | "ACTIVE_RENTAL"
  | "RETURN_GUIDANCE"
  | "RETURN_VALIDATING"
  | "RETURN_ACCEPTED"
  | "SETTLEMENT_PENDING"
  | "COMPLETED"
  | "RECOVERY"
  | "OFFLINE"
  | "ERROR"
  | "SUPPORT_REQUIRED";

export type ReaderState =
  | "UNAVAILABLE"
  | "ABSENT"
  | "DISCOVERING"
  | "CONNECTING"
  | "RECONNECTING"
  | "UPDATING"
  | "READY"
  | "BUSY"
  | "ERROR";

export type PaymentCapability = "TERMINAL_AND_QR" | "QR_ONLY";
export type PaymentRail = "NONE" | "TERMINAL" | "QR";
export type PaymentRailState =
  | "UNCLAIMED"
  | "CLAIMING"
  | "ENGAGED"
  | "PROCESSING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLING"
  | "CANCELLED"
  | "EXPIRED";

export type SurfaceKind = "KIOSK" | "TABLET" | "MOBILE" | "WEB";
export type ViewportClass = "KIOSK_1280x720" | "TABLET" | "MOBILE" | "DESKTOP";

export type ChargeursPresentationModel = {
  version: 1;
  surface: {
    kind: SurfaceKind;
    nativeBridge: boolean;
    viewportClass: ViewportClass;
    reducedMotion: boolean;
    renderTier: "HIGH" | "MEDIUM" | "SAFE";
  };
  journey: {
    state: ChargeursJourneyState;
    previousState?: ChargeursJourneyState;
    recoverable: boolean;
    supportRequired: boolean;
    correlationId?: string;
  };
  station: {
    stationId?: string;
    online: boolean;
    selectedSlot?: number;
    slotTopology: "1|3/2|4" | "UNKNOWN";
  };
  pricing: {
    status: "UNKNOWN" | "READY" | "UNAVAILABLE";
    segment?: "guest" | "member";
    currency?: "CHF";
    serverQuoteOnly: true;
  };
  reader: {
    state: ReaderState;
    capability: PaymentCapability;
    safeMessageCode?: string;
  };
  payment: {
    rail: PaymentRail;
    railState: PaymentRailState;
    canChooseTerminal: boolean;
    canChooseQr: boolean;
    serverConfirmed: boolean;
  };
  hardware: {
    releaseState: "NONE" | "WAITING" | "PHYSICALLY_CONFIRMED" | "AMBIGUOUS" | "FAILED";
    expectedSlot?: number;
    confirmedSlot?: number;
    contractualBatteryId?: string;
  };
  return: {
    state: "NONE" | "GUIDANCE" | "VALIDATING" | "ACCEPTED" | "AMBIGUOUS" | "FAILED";
    physicalEvidenceAccepted: boolean;
    returnedSlot?: number;
  };
  visuals: {
    sceneCue:
      | "BOOT"
      | "HOME_IDLE"
      | "SLOT_FOCUS"
      | "PAYMENT_READY"
      | "TERMINAL_PROCESSING"
      | "QR_PROCESSING"
      | "PAYMENT_CONFIRMED"
      | "RELEASE_WAIT"
      | "RELEASE_CONFIRMED"
      | "ACTIVE"
      | "RETURN_GUIDANCE"
      | "RETURN_ACCEPTED"
      | "RECOVERY"
      | "ERROR"
      | "OFFLINE";
  };
};

export type NativeReaderProjection = {
  readerState?: unknown;
  capability?: unknown;
  payment?: {
    rail?: unknown;
    railState?: unknown;
    serverConfirmed?: unknown;
    recoveryRequired?: unknown;
    correlationId?: unknown;
  } | null;
  diagnostics?: {
    errorCode?: unknown;
  } | null;
};

const READER_STATES = new Set<ReaderState>([
  "UNAVAILABLE", "ABSENT", "DISCOVERING", "CONNECTING", "RECONNECTING", "UPDATING", "READY", "BUSY", "ERROR",
]);
const RAILS = new Set<PaymentRail>(["NONE", "TERMINAL", "QR"]);
const RAIL_STATES = new Set<PaymentRailState>([
  "UNCLAIMED", "CLAIMING", "ENGAGED", "PROCESSING", "SUCCEEDED", "FAILED", "CANCELLING", "CANCELLED", "EXPIRED",
]);

export function canonicalReaderState(value: unknown, nativeBridge: boolean): ReaderState {
  if (!nativeBridge) return "UNAVAILABLE";
  return typeof value === "string" && READER_STATES.has(value as ReaderState) ? value as ReaderState : "UNAVAILABLE";
}

export function canonicalPaymentRail(value: unknown): PaymentRail {
  return typeof value === "string" && RAILS.has(value as PaymentRail) ? value as PaymentRail : "NONE";
}

export function canonicalPaymentRailState(value: unknown, recoveryRequired = false): PaymentRailState {
  if (recoveryRequired) return "FAILED";
  if (value === "RECOVERY_REQUIRED") return "FAILED";
  return typeof value === "string" && RAIL_STATES.has(value as PaymentRailState)
    ? value as PaymentRailState
    : "UNCLAIMED";
}

export function derivePaymentCapability(readerState: ReaderState, nativeBridge: boolean): PaymentCapability {
  return nativeBridge && readerState === "READY" ? "TERMINAL_AND_QR" : "QR_ONLY";
}

export function deriveSurfaceKind(width: number, height: number, nativeBridge: boolean): { kind: SurfaceKind; viewportClass: ViewportClass } {
  if (nativeBridge && width >= 640 && height >= 360) return { kind: "KIOSK", viewportClass: "KIOSK_1280x720" };
  if (width <= 480) return { kind: "MOBILE", viewportClass: "MOBILE" };
  if (width <= 1024) return { kind: "TABLET", viewportClass: "TABLET" };
  return { kind: "WEB", viewportClass: "DESKTOP" };
}

export function buildChargeursPresentationModel(input: {
  width: number;
  height: number;
  nativeBridge: boolean;
  reducedMotion?: boolean;
  journeyState: ChargeursJourneyState;
  previousJourneyState?: ChargeursJourneyState;
  stationId?: string;
  stationOnline: boolean;
  selectedSlot?: number;
  pricingReady: boolean;
  pricingSegment?: "guest" | "member";
  pricingCurrency?: string;
  reader?: NativeReaderProjection | null;
  localRail?: PaymentRail;
  localRailState?: PaymentRailState;
}): ChargeursPresentationModel {
  const surface = deriveSurfaceKind(input.width, input.height, input.nativeBridge);
  const readerState = canonicalReaderState(input.reader?.readerState, input.nativeBridge);
  const nativeCapability = input.reader?.capability === "TERMINAL_AND_QR" ? "TERMINAL_AND_QR" : "QR_ONLY";
  const capability = derivePaymentCapability(readerState, input.nativeBridge) === "TERMINAL_AND_QR" && nativeCapability === "TERMINAL_AND_QR"
    ? "TERMINAL_AND_QR"
    : "QR_ONLY";
  const backendRail = canonicalPaymentRail(input.reader?.payment?.rail);
  const rail = backendRail !== "NONE" ? backendRail : (input.localRail ?? "NONE");
  const recoveryRequired = input.reader?.payment?.recoveryRequired === true;
  const backendRailState = canonicalPaymentRailState(input.reader?.payment?.railState, recoveryRequired);
  const railState = backendRailState !== "UNCLAIMED" ? backendRailState : (input.localRailState ?? "UNCLAIMED");
  const engaged = rail !== "NONE" || !["UNCLAIMED", "CANCELLED", "EXPIRED"].includes(railState);
  const paymentReady = input.journeyState === "PAYMENT_READY";
  const canChooseTerminal = paymentReady && !engaged && capability === "TERMINAL_AND_QR";
  const canChooseQr = paymentReady && !engaged;
  const serverConfirmed = input.reader?.payment?.serverConfirmed === true;
  const safeMessageCode = typeof input.reader?.diagnostics?.errorCode === "string"
    ? input.reader.diagnostics.errorCode
    : undefined;
  const correlationId = typeof input.reader?.payment?.correlationId === "string"
    ? input.reader.payment.correlationId
    : undefined;

  const sceneCue: ChargeursPresentationModel["visuals"]["sceneCue"] =
    input.journeyState === "PAYMENT_READY" ? "PAYMENT_READY" :
    input.journeyState === "PAYMENT_IN_PROGRESS" && rail === "TERMINAL" ? "TERMINAL_PROCESSING" :
    input.journeyState === "PAYMENT_IN_PROGRESS" && rail === "QR" ? "QR_PROCESSING" :
    input.journeyState === "PAYMENT_CONFIRMED" ? "PAYMENT_CONFIRMED" :
    input.journeyState === "HARDWARE_WAIT" ? "RELEASE_WAIT" :
    input.journeyState === "RELEASE_CONFIRMED" ? "RELEASE_CONFIRMED" :
    input.journeyState === "ACTIVE_RENTAL" ? "ACTIVE" :
    input.journeyState === "RETURN_GUIDANCE" ? "RETURN_GUIDANCE" :
    input.journeyState === "RETURN_ACCEPTED" ? "RETURN_ACCEPTED" :
    input.journeyState === "RECOVERY" || recoveryRequired ? "RECOVERY" :
    input.journeyState === "OFFLINE" ? "OFFLINE" :
    input.journeyState === "ERROR" || input.journeyState === "SUPPORT_REQUIRED" ? "ERROR" :
    input.journeyState === "HOME" ? "HOME_IDLE" :
    input.journeyState === "SELECTION" || input.journeyState === "PRICING" ? "SLOT_FOCUS" : "BOOT";

  return {
    version: 1,
    surface: {
      ...surface,
      nativeBridge: input.nativeBridge,
      reducedMotion: input.reducedMotion ?? false,
      renderTier: input.reducedMotion ? "SAFE" : "HIGH",
    },
    journey: {
      state: recoveryRequired ? "RECOVERY" : input.journeyState,
      previousState: input.previousJourneyState,
      recoverable: recoveryRequired || ["ERROR", "OFFLINE", "RECOVERY"].includes(input.journeyState),
      supportRequired: input.journeyState === "SUPPORT_REQUIRED",
      correlationId,
    },
    station: {
      stationId: input.stationId,
      online: input.stationOnline,
      selectedSlot: input.selectedSlot,
      slotTopology: "1|3/2|4",
    },
    pricing: {
      status: input.pricingReady ? "READY" : "UNKNOWN",
      segment: input.pricingSegment,
      currency: input.pricingCurrency?.toUpperCase() === "CHF" ? "CHF" : undefined,
      serverQuoteOnly: true,
    },
    reader: { state: readerState, capability, safeMessageCode },
    payment: { rail, railState, canChooseTerminal, canChooseQr, serverConfirmed },
    hardware: {
      releaseState: input.journeyState === "HARDWARE_WAIT" ? "WAITING" : input.journeyState === "RELEASE_CONFIRMED" || input.journeyState === "ACTIVE_RENTAL" ? "PHYSICALLY_CONFIRMED" : "NONE",
      expectedSlot: input.selectedSlot,
    },
    return: {
      state: input.journeyState === "RETURN_GUIDANCE" ? "GUIDANCE" : input.journeyState === "RETURN_VALIDATING" ? "VALIDATING" : input.journeyState === "RETURN_ACCEPTED" ? "ACCEPTED" : "NONE",
      physicalEvidenceAccepted: input.journeyState === "RETURN_ACCEPTED" || input.journeyState === "SETTLEMENT_PENDING" || input.journeyState === "COMPLETED",
    },
    visuals: { sceneCue },
  };
}
