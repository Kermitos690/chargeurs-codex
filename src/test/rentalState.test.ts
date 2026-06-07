import { describe, it, expect } from "vitest";
import { canTransition, isTerminal, TERMINAL_STATES, type RentalState } from "@/lib/rentalState";

describe("rental state machine", () => {
  it("never regresses from terminal states", () => {
    const targets: RentalState[] = ["active_rental", "battery_returned", "payment_succeeded", "ejected"];
    for (const t of TERMINAL_STATES) {
      for (const to of targets) {
        expect(canTransition(t, to)).toBe(false);
      }
    }
  });

  it("closed never returns to active_rental", () => {
    expect(canTransition("closed", "active_rental")).toBe(false);
  });

  it("refunded never returns to battery_returned", () => {
    expect(canTransition("refunded", "battery_returned")).toBe(false);
  });

  it("battery_returned only from active/taken/ejected states", () => {
    expect(canTransition("active_rental", "battery_returned")).toBe(true);
    expect(canTransition("battery_taken", "battery_returned")).toBe(true);
    expect(canTransition("ejected", "battery_returned")).toBe(true);
    // not from a pre-ejection state
    expect(canTransition("payment_succeeded", "battery_returned")).toBe(false);
    expect(canTransition("created", "battery_returned")).toBe(false);
  });

  it("payment success does not imply ejection success", () => {
    // payment_succeeded must go through ejecting before ejected
    expect(canTransition("payment_succeeded", "ejected")).toBe(false);
    expect(canTransition("payment_succeeded", "ejecting")).toBe(true);
    expect(canTransition("ejecting", "ejected")).toBe(true);
  });

  it("is idempotent for self-transitions (safe retries)", () => {
    const states: RentalState[] = ["payment_succeeded", "ejected", "battery_returned", "closed", "refunded"];
    for (const s of states) expect(canTransition(s, s)).toBe(true);
  });

  it("allows needs_support escalation from any non-terminal state", () => {
    expect(canTransition("ejecting", "needs_support")).toBe(true);
    expect(canTransition("eject_failed", "needs_support")).toBe(true);
    expect(canTransition("battery_returned", "needs_support")).toBe(true);
    // but not from terminal
    expect(canTransition("closed", "needs_support")).toBe(false);
  });

  it("happy path is fully connected", () => {
    const path: RentalState[] = [
      "created", "payment_pending", "payment_succeeded", "ejecting",
      "ejected", "battery_taken", "active_rental", "battery_returned",
      "closing", "closed",
    ];
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i], path[i + 1])).toBe(true);
    }
  });

  it("marks terminal states correctly", () => {
    expect(isTerminal("closed")).toBe(true);
    expect(isTerminal("refunded")).toBe(true);
    expect(isTerminal("cancelled")).toBe(true);
    expect(isTerminal("active_rental")).toBe(false);
  });
});
