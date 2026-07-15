export type RentalState =
  | "created"
  | "payment_pending"
  | "authorized"
  | "release_requested"
  | "released"
  | "active"
  | "return_detected"
  | "pricing_finalized"
  | "payment_captured"
  | "refunded"
  | "completed"
  | "failed"
  | "non_return";

export type RentalEventType =
  | "payment_started"
  | "payment_authorized"
  | "release_requested"
  | "battery_released"
  | "rental_activated"
  | "return_detected"
  | "pricing_finalized"
  | "payment_captured"
  | "payment_refunded"
  | "rental_completed"
  | "rental_failed"
  | "non_return_declared";

export type RentalEvent = {
  id: string;
  rentalId: string;
  type: RentalEventType;
  occurredAt: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
};

export type RentalSnapshot = {
  rentalId: string;
  state: RentalState;
  version: number;
  events: RentalEvent[];
  paymentIntentId?: string;
  batteryId?: string;
  stationId?: string;
  finalAmountChf?: number;
  failureReason?: string;
};

export type TransitionResult =
  | { ok: true; snapshot: RentalSnapshot; replayed: boolean }
  | { ok: false; code: "INVALID_TRANSITION" | "DUPLICATE_EVENT" | "INVALID_EVENT"; message: string };

const EVENT_TARGET: Record<RentalEventType, RentalState> = {
  payment_started: "payment_pending",
  payment_authorized: "authorized",
  release_requested: "release_requested",
  battery_released: "released",
  rental_activated: "active",
  return_detected: "return_detected",
  pricing_finalized: "pricing_finalized",
  payment_captured: "payment_captured",
  payment_refunded: "refunded",
  rental_completed: "completed",
  rental_failed: "failed",
  non_return_declared: "non_return",
};

const ALLOWED_TRANSITIONS: Record<RentalState, RentalState[]> = {
  created: ["payment_pending", "failed"],
  payment_pending: ["authorized", "failed"],
  authorized: ["release_requested", "refunded", "failed"],
  release_requested: ["released", "refunded", "failed"],
  released: ["active", "failed"],
  active: ["return_detected", "non_return", "failed"],
  return_detected: ["pricing_finalized", "failed"],
  pricing_finalized: ["payment_captured", "refunded", "failed"],
  payment_captured: ["completed", "refunded", "failed"],
  refunded: ["completed", "failed"],
  completed: [],
  failed: [],
  non_return: ["pricing_finalized", "payment_captured", "completed", "failed"],
};

function isValidIsoDate(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function validateEvent(event: RentalEvent): string | null {
  if (!event.id.trim()) return "Identifiant d'événement manquant";
  if (!event.rentalId.trim()) return "Identifiant de location manquant";
  if (!event.idempotencyKey.trim()) return "Clé d'idempotence manquante";
  if (!isValidIsoDate(event.occurredAt)) return "Date d'événement invalide";
  return null;
}

export function createRentalSnapshot(rentalId: string): RentalSnapshot {
  if (!rentalId.trim()) throw new Error("rentalId is required");
  return { rentalId, state: "created", version: 0, events: [] };
}

export function canTransition(from: RentalState, to: RentalState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function applyRentalEvent(snapshot: RentalSnapshot, event: RentalEvent): TransitionResult {
  const validationError = validateEvent(event);
  if (validationError) {
    return { ok: false, code: "INVALID_EVENT", message: validationError };
  }

  if (snapshot.rentalId !== event.rentalId) {
    return { ok: false, code: "INVALID_EVENT", message: "L'événement appartient à une autre location" };
  }

  const existing = snapshot.events.find((item) => item.idempotencyKey === event.idempotencyKey);
  if (existing) {
    if (existing.type === event.type && existing.rentalId === event.rentalId) {
      return { ok: true, snapshot, replayed: true };
    }
    return {
      ok: false,
      code: "DUPLICATE_EVENT",
      message: "Cette clé d'idempotence est déjà utilisée par un autre événement",
    };
  }

  const target = EVENT_TARGET[event.type];
  if (!canTransition(snapshot.state, target)) {
    return {
      ok: false,
      code: "INVALID_TRANSITION",
      message: `Transition interdite : ${snapshot.state} → ${target}`,
    };
  }

  const next: RentalSnapshot = {
    ...snapshot,
    state: target,
    version: snapshot.version + 1,
    events: [...snapshot.events, event],
  };

  const metadata = event.metadata ?? {};
  if (typeof metadata.paymentIntentId === "string") next.paymentIntentId = metadata.paymentIntentId;
  if (typeof metadata.batteryId === "string") next.batteryId = metadata.batteryId;
  if (typeof metadata.stationId === "string") next.stationId = metadata.stationId;
  if (typeof metadata.finalAmountChf === "number" && Number.isFinite(metadata.finalAmountChf)) {
    next.finalAmountChf = metadata.finalAmountChf;
  }
  if (typeof metadata.failureReason === "string") next.failureReason = metadata.failureReason;

  return { ok: true, snapshot: next, replayed: false };
}

export function reduceRentalEvents(rentalId: string, events: RentalEvent[]): TransitionResult {
  let snapshot = createRentalSnapshot(rentalId);
  for (const event of events) {
    const result = applyRentalEvent(snapshot, event);
    if (!result.ok) return result;
    snapshot = result.snapshot;
  }
  return { ok: true, snapshot, replayed: false };
}

export type CompensationAction =
  | { type: "cancel_payment_authorization"; reason: string }
  | { type: "open_incident"; reason: string }
  | { type: "notify_customer"; reason: string }
  | { type: "none" };

export function planCompensation(snapshot: RentalSnapshot): CompensationAction[] {
  if (snapshot.state === "failed" && snapshot.paymentIntentId && !snapshot.batteryId) {
    return [
      { type: "cancel_payment_authorization", reason: snapshot.failureReason ?? "Éjection non confirmée" },
      { type: "open_incident", reason: snapshot.failureReason ?? "Location interrompue après autorisation" },
      { type: "notify_customer", reason: "La batterie n'a pas pu être délivrée. Aucun montant ne doit être capturé." },
    ];
  }
  return [{ type: "none" }];
}
