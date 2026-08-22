import { describe, expect, it } from "vitest";
import {
  hasServerConfirmedTerminalCancellation,
  shouldLeaveTerminalPaymentStage,
} from "@/lib/kioskTerminalCancellation";

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

  it("handles a WisePad STOP without requiring a kiosk-button click", () => {
    const reader = {
      readerState: "READY" as const,
      capability: "TERMINAL_AND_QR" as const,
      payment: { rail: "NONE" as const, railState: "CANCELLED" as const, serverConfirmed: false, recoveryRequired: false },
    };
    expect(shouldLeaveTerminalPaymentStage(reader, false)).toBe(true);
    expect(shouldLeaveTerminalPaymentStage(reader, true)).toBe(false);
  });
});
