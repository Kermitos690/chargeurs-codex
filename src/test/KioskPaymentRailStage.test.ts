import { describe, expect, it } from "vitest";
import { shouldReturnHomeAfterTerminalCancellation } from "@/components/kiosk/KioskPaymentRailStage";

describe("terminal cancellation handoff", () => {
  const cancelledReader = {
    readerState: "READY",
    payment: {
      rail: "NONE",
      railState: "CANCELLED",
      serverConfirmed: false,
      recoveryRequired: false,
    },
  };

  it("does not apply a previous WisePad cancellation to a fresh rental", () => {
    expect(shouldReturnHomeAfterTerminalCancellation(cancelledReader, false)).toBe(false);
  });

  it("returns home after the WisePad cancellation of the engaged rental", () => {
    expect(shouldReturnHomeAfterTerminalCancellation(cancelledReader, true)).toBe(true);
  });

  it("does not hide a cancellation that requires reconciliation", () => {
    expect(shouldReturnHomeAfterTerminalCancellation({
      ...cancelledReader,
      payment: { ...cancelledReader.payment, recoveryRequired: true },
    }, true)).toBe(false);
  });
});
