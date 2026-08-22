import { describe, expect, it } from "vitest";
import { hasServerConfirmedTerminalCancellation } from "@/lib/kioskTerminalCancellation";

describe("terminal cancellation presentation guard", () => {
  it("returns to the payment choice only after the server has released the terminal rail", () => {
    expect(hasServerConfirmedTerminalCancellation({
      readerState: "READY",
      capability: "TERMINAL_AND_QR",
      payment: { rail: "NONE", railState: "CANCELLED", serverConfirmed: false, recoveryRequired: false },
    })).toBe(true);
  });

  it("does not treat a local cancellation, payment confirmation, or recovery as safe to leave", () => {
    expect(hasServerConfirmedTerminalCancellation({
      readerState: "BUSY",
      capability: "TERMINAL_AND_QR",
      payment: { rail: "TERMINAL", railState: "CANCELLING", serverConfirmed: false, recoveryRequired: false },
    })).toBe(false);
    expect(hasServerConfirmedTerminalCancellation({
      readerState: "READY",
      capability: "TERMINAL_AND_QR",
      payment: { rail: "NONE", railState: "CANCELLED", serverConfirmed: true, recoveryRequired: false },
    })).toBe(false);
    expect(hasServerConfirmedTerminalCancellation({
      readerState: "READY",
      capability: "TERMINAL_AND_QR",
      payment: { rail: "NONE", railState: "CANCELLED", serverConfirmed: false, recoveryRequired: true },
    })).toBe(false);
  });
});
