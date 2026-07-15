import { describe, expect, it } from "vitest";
import { createRentalSnapshot, type RentalEvent, type RentalSnapshot } from "@/lib/rentalOrchestrator";
import { assertPersistEventInput, mapStorageError } from "@/lib/rentalOrchestratorStorage";

const event: RentalEvent = {
  id: "evt-1",
  rentalId: "rental-1",
  type: "payment_started",
  occurredAt: "2026-07-15T10:00:00.000Z",
  idempotencyKey: "stripe:evt-1",
};

function after(before: RentalSnapshot): RentalSnapshot {
  return {
    ...before,
    state: "payment_pending",
    version: before.version + 1,
    events: [event],
  };
}

describe("rentalOrchestratorStorage", () => {
  it("accepte un append cohérent", () => {
    const before = createRentalSnapshot("rental-1");
    expect(() => assertPersistEventInput({ snapshotBefore: before, event, snapshotAfter: after(before) })).not.toThrow();
  });

  it("refuse un identifiant de location divergent", () => {
    const before = createRentalSnapshot("rental-1");
    expect(() =>
      assertPersistEventInput({
        snapshotBefore: before,
        event: { ...event, rentalId: "rental-2" },
        snapshotAfter: after(before),
      }),
    ).toThrow("RENTAL_ID_MISMATCH");
  });

  it("refuse un saut de version", () => {
    const before = createRentalSnapshot("rental-1");
    expect(() =>
      assertPersistEventInput({
        snapshotBefore: before,
        event,
        snapshotAfter: { ...after(before), version: 3 },
      }),
    ).toThrow("INVALID_VERSION_INCREMENT");
  });

  it("refuse une clé d'idempotence vide", () => {
    const before = createRentalSnapshot("rental-1");
    expect(() =>
      assertPersistEventInput({
        snapshotBefore: before,
        event: { ...event, idempotencyKey: "  " },
        snapshotAfter: after(before),
      }),
    ).toThrow("EMPTY_IDEMPOTENCY_KEY");
  });

  it("classe les erreurs PostgreSQL connues", () => {
    expect(mapStorageError("RENTAL_NOT_FOUND").code).toBe("RENTAL_NOT_FOUND");
    expect(mapStorageError("VERSION_CONFLICT").code).toBe("VERSION_CONFLICT");
    expect(mapStorageError("IDEMPOTENCY_KEY_CONFLICT").code).toBe("IDEMPOTENCY_KEY_CONFLICT");
    expect(mapStorageError("network unavailable").code).toBe("STORAGE_ERROR");
  });
});
