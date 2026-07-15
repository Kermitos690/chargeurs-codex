import type { RentalEvent, RentalSnapshot } from "@/lib/rentalOrchestrator";

export type ExternalEventSource = "stripe" | "chargenow" | "kiosk" | "admin" | "system";

export type StoredExternalEvent = {
  source: ExternalEventSource;
  externalEventId: string;
  rentalId?: string;
  eventType: string;
  payload: Record<string, unknown>;
  receivedAt: string;
};

export type PersistEventInput = {
  snapshotBefore: RentalSnapshot;
  event: RentalEvent;
  snapshotAfter: RentalSnapshot;
};

export type PersistEventResult =
  | { ok: true; snapshot: RentalSnapshot; replayed: boolean }
  | {
      ok: false;
      code: "RENTAL_NOT_FOUND" | "VERSION_CONFLICT" | "IDEMPOTENCY_KEY_CONFLICT" | "STORAGE_ERROR";
      message: string;
    };

export interface RentalOrchestratorStorage {
  create(snapshot: RentalSnapshot): Promise<void>;
  get(rentalId: string): Promise<RentalSnapshot | null>;
  append(input: PersistEventInput): Promise<PersistEventResult>;
  recordExternalEvent(event: StoredExternalEvent): Promise<"created" | "duplicate">;
}

export function assertPersistEventInput(input: PersistEventInput): void {
  const { snapshotBefore, snapshotAfter, event } = input;

  if (snapshotBefore.rentalId !== snapshotAfter.rentalId || event.rentalId !== snapshotBefore.rentalId) {
    throw new Error("RENTAL_ID_MISMATCH");
  }

  if (snapshotAfter.version !== snapshotBefore.version + 1) {
    throw new Error("INVALID_VERSION_INCREMENT");
  }

  if (!event.idempotencyKey.trim()) {
    throw new Error("EMPTY_IDEMPOTENCY_KEY");
  }

  if (!Number.isFinite(Date.parse(event.occurredAt))) {
    throw new Error("INVALID_EVENT_DATE");
  }
}

export function mapStorageError(message: string): Exclude<PersistEventResult, { ok: true }> {
  if (message.includes("RENTAL_NOT_FOUND")) {
    return { ok: false, code: "RENTAL_NOT_FOUND", message };
  }
  if (message.includes("VERSION_CONFLICT")) {
    return { ok: false, code: "VERSION_CONFLICT", message };
  }
  if (message.includes("IDEMPOTENCY_KEY_CONFLICT")) {
    return { ok: false, code: "IDEMPOTENCY_KEY_CONFLICT", message };
  }
  return { ok: false, code: "STORAGE_ERROR", message };
}
