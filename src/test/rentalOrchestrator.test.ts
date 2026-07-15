import { describe, expect, it } from "vitest";
import {
  applyRentalEvent,
  createRentalSnapshot,
  planCompensation,
  reduceRentalEvents,
  type RentalEvent,
  type RentalEventType,
  type RentalSnapshot,
} from "@/lib/rentalOrchestrator";

const at = "2026-07-15T10:00:00.000Z";

function event(type: RentalEventType, index: number, metadata?: Record<string, unknown>): RentalEvent {
  return {
    id: `evt-${index}`,
    rentalId: "rental-1",
    type,
    occurredAt: at,
    idempotencyKey: `idem-${index}`,
    metadata,
  };
}

describe("rentalOrchestrator", () => {
  it("exécute le parcours nominal jusqu'à completed", () => {
    const events = [
      event("payment_started", 1),
      event("payment_authorized", 2, { paymentIntentId: "pi_123" }),
      event("release_requested", 3, { stationId: "DTA21269" }),
      event("battery_released", 4, { batteryId: "PB-0041" }),
      event("rental_activated", 5),
      event("return_detected", 6),
      event("pricing_finalized", 7, { finalAmountChf: 4.5 }),
      event("payment_captured", 8),
      event("rental_completed", 9),
    ];

    const result = reduceRentalEvents("rental-1", events);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.state).toBe("completed");
    expect(result.snapshot.version).toBe(9);
    expect(result.snapshot.paymentIntentId).toBe("pi_123");
    expect(result.snapshot.stationId).toBe("DTA21269");
    expect(result.snapshot.batteryId).toBe("PB-0041");
    expect(result.snapshot.finalAmountChf).toBe(4.5);
  });

  it("refuse une transition incohérente", () => {
    const snapshot = createRentalSnapshot("rental-1");
    const result = applyRentalEvent(snapshot, event("rental_completed", 1));
    expect(result.ok).toBe(false);
    expect("code" in result ? result.code : null).toBe("INVALID_TRANSITION");
  });

  it("rejoue sans effet un événement idempotent identique", () => {
    const first = applyRentalEvent(createRentalSnapshot("rental-1"), event("payment_started", 1));
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const replay = applyRentalEvent(first.snapshot, event("payment_started", 1));
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.replayed).toBe(true);
    expect(replay.snapshot.version).toBe(1);
    expect(replay.snapshot.events).toHaveLength(1);
  });

  it("refuse la réutilisation d'une clé d'idempotence pour une autre action", () => {
    const firstEvent = event("payment_started", 1);
    const first = applyRentalEvent(createRentalSnapshot("rental-1"), firstEvent);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const conflicting = { ...event("rental_failed", 2), idempotencyKey: firstEvent.idempotencyKey };
    const result = applyRentalEvent(first.snapshot, conflicting);
    expect(result.ok).toBe(false);
    expect("code" in result ? result.code : null).toBe("DUPLICATE_EVENT");
  });

  it("prépare une compensation après autorisation sans batterie délivrée", () => {
    const snapshot: RentalSnapshot = {
      rentalId: "rental-1",
      state: "failed",
      version: 3,
      events: [],
      paymentIntentId: "pi_123",
      failureReason: "Éjection fournisseur expirée",
    };

    const actions = planCompensation(snapshot);
    expect(actions.map((action) => action.type)).toEqual([
      "cancel_payment_authorization",
      "open_incident",
      "notify_customer",
    ]);
  });

  it("valide le parcours non-retour vers capture puis clôture", () => {
    const events = [
      event("payment_started", 1),
      event("payment_authorized", 2),
      event("release_requested", 3),
      event("battery_released", 4, { batteryId: "PB-0041" }),
      event("rental_activated", 5),
      event("non_return_declared", 6),
      event("pricing_finalized", 7, { finalAmountChf: 99 }),
      event("payment_captured", 8),
      event("rental_completed", 9),
    ];

    const result = reduceRentalEvents("rental-1", events);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.state).toBe("completed");
    expect(result.snapshot.finalAmountChf).toBe(99);
  });
});
