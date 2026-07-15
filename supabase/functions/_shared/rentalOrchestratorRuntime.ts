// Canonical server-side bridge for Rental Orchestrator transitions.
//
// This module validates transitions before calling the atomic PostgreSQL append
// function. Browser, kiosk and provider payloads must never write final states
// directly.

type DB = {
  from: (table: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: any }>;
};

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

export type OrchestratorSnapshot = {
  rental_id: string;
  state: RentalState;
  version: number;
  payment_intent_id?: string | null;
  station_id?: string | null;
  battery_id?: string | null;
  final_amount_chf?: number | null;
  failure_reason?: string | null;
};

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

export class OrchestratorError extends Error {
  constructor(public readonly code: string, message = code) {
    super(message);
    this.name = "OrchestratorError";
  }
}

export function targetState(eventType: RentalEventType): RentalState {
  return EVENT_TARGET[eventType];
}

export function canApplyTransition(from: RentalState, eventType: RentalEventType): boolean {
  return ALLOWED_TRANSITIONS[from].includes(EVENT_TARGET[eventType]);
}

function asSnapshot(value: unknown): OrchestratorSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.rental_id !== "string" || typeof row.state !== "string") return null;
  return {
    rental_id: row.rental_id,
    state: row.state as RentalState,
    version: Number(row.version ?? 0),
    payment_intent_id: typeof row.payment_intent_id === "string" ? row.payment_intent_id : null,
    station_id: typeof row.station_id === "string" ? row.station_id : null,
    battery_id: typeof row.battery_id === "string" ? row.battery_id : null,
    final_amount_chf: row.final_amount_chf == null ? null : Number(row.final_amount_chf),
    failure_reason: typeof row.failure_reason === "string" ? row.failure_reason : null,
  };
}

export async function ensureRentalSnapshot(
  db: DB,
  input: { rentalId: string; stationId?: string | null },
): Promise<OrchestratorSnapshot> {
  const { data: existing, error: readError } = await db
    .from("rental_orchestrator_snapshots")
    .select("*")
    .eq("rental_id", input.rentalId)
    .maybeSingle();
  if (readError) throw new OrchestratorError("ORCHESTRATOR_READ_FAILED", readError.message);

  const parsed = asSnapshot(existing);
  if (parsed) return parsed;

  const { data: inserted, error: insertError } = await db
    .from("rental_orchestrator_snapshots")
    .insert({
      rental_id: input.rentalId,
      state: "created",
      version: 0,
      station_id: input.stationId ?? null,
    })
    .select("*")
    .single();

  if (!insertError) {
    const snapshot = asSnapshot(inserted);
    if (!snapshot) throw new OrchestratorError("ORCHESTRATOR_INVALID_SNAPSHOT");
    return snapshot;
  }

  // A concurrent initializer may have won the unique-key race.
  if (insertError.code === "23505") {
    const { data: raced, error: raceReadError } = await db
      .from("rental_orchestrator_snapshots")
      .select("*")
      .eq("rental_id", input.rentalId)
      .single();
    if (raceReadError) throw new OrchestratorError("ORCHESTRATOR_READ_FAILED", raceReadError.message);
    const snapshot = asSnapshot(raced);
    if (!snapshot) throw new OrchestratorError("ORCHESTRATOR_INVALID_SNAPSHOT");
    return snapshot;
  }

  throw new OrchestratorError("ORCHESTRATOR_CREATE_FAILED", insertError.message);
}

export async function appendRentalEvent(
  db: DB,
  input: {
    rentalId: string;
    eventType: RentalEventType;
    idempotencyKey: string;
    occurredAt?: string;
    metadata?: Record<string, unknown>;
    paymentIntentId?: string | null;
    stationId?: string | null;
    batteryId?: string | null;
    finalAmountChf?: number | null;
    failureReason?: string | null;
  },
): Promise<{ snapshot: OrchestratorSnapshot; replayed: boolean }> {
  if (!input.rentalId || !input.idempotencyKey.trim()) {
    throw new OrchestratorError("ORCHESTRATOR_INVALID_EVENT");
  }

  const occurredAt = input.occurredAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(occurredAt))) {
    throw new OrchestratorError("ORCHESTRATOR_INVALID_EVENT_DATE");
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const snapshot = await ensureRentalSnapshot(db, {
      rentalId: input.rentalId,
      stationId: input.stationId,
    });

    const { data: existingEvent, error: existingError } = await db
      .from("rental_orchestrator_events")
      .select("event_type")
      .eq("rental_id", input.rentalId)
      .eq("idempotency_key", input.idempotencyKey)
      .maybeSingle();
    if (existingError) throw new OrchestratorError("ORCHESTRATOR_EVENT_READ_FAILED", existingError.message);
    if (existingEvent) {
      if (existingEvent.event_type !== input.eventType) {
        throw new OrchestratorError("IDEMPOTENCY_KEY_CONFLICT");
      }
      return { snapshot, replayed: true };
    }

    if (!canApplyTransition(snapshot.state, input.eventType)) {
      throw new OrchestratorError(
        "INVALID_TRANSITION",
        `Transition interdite : ${snapshot.state} → ${targetState(input.eventType)}`,
      );
    }

    const { data, error } = await db.rpc("append_rental_orchestrator_event", {
      p_rental_id: input.rentalId,
      p_expected_version: snapshot.version,
      p_event_type: input.eventType,
      p_idempotency_key: input.idempotencyKey,
      p_occurred_at: occurredAt,
      p_metadata: input.metadata ?? {},
      p_resulting_state: targetState(input.eventType),
      p_payment_intent_id: input.paymentIntentId ?? null,
      p_station_id: input.stationId ?? null,
      p_battery_id: input.batteryId ?? null,
      p_final_amount_chf: input.finalAmountChf ?? null,
      p_failure_reason: input.failureReason ?? null,
    });

    if (!error) {
      const updated = asSnapshot(data);
      if (!updated) throw new OrchestratorError("ORCHESTRATOR_INVALID_SNAPSHOT");
      return { snapshot: updated, replayed: false };
    }

    if (error.message?.includes("VERSION_CONFLICT") || error.code === "40001") continue;
    if (error.message?.includes("IDEMPOTENCY_KEY_CONFLICT") || error.code === "23505") {
      throw new OrchestratorError("IDEMPOTENCY_KEY_CONFLICT");
    }
    if (error.message?.includes("RENTAL_NOT_FOUND") || error.code === "P0002") {
      throw new OrchestratorError("RENTAL_NOT_FOUND");
    }
    throw new OrchestratorError("ORCHESTRATOR_APPEND_FAILED", error.message);
  }

  throw new OrchestratorError("VERSION_CONFLICT");
}
