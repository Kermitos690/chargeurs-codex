import { describe, expect, it } from "vitest";
import { buildChargeursPresentationModel } from "@/lib/chargeursPresentationModel";

const base = {
  width: 1280,
  height: 720,
  nativeBridge: true,
  journeyState: "PAYMENT_READY" as const,
  stationId: "DTA21269",
  stationOnline: true,
  selectedSlot: 1,
  pricingReady: true,
  pricingCurrency: "CHF",
};

describe("ChargeursPresentationModel #169/#171", () => {
  it("never treats USB presence alone as reader READY", () => {
    const model = buildChargeursPresentationModel({
      ...base,
      reader: {
        readerState: "CONNECTING",
        capability: "QR_ONLY",
        diagnostics: { errorCode: undefined },
      },
    });
    expect(model.reader.state).toBe("CONNECTING");
    expect(model.reader.capability).toBe("QR_ONLY");
    expect(model.payment.canChooseTerminal).toBe(false);
    expect(model.payment.canChooseQr).toBe(true);
  });

  it("exposes Terminal and QR only for a Stripe READY native reader", () => {
    const model = buildChargeursPresentationModel({
      ...base,
      reader: { readerState: "READY", capability: "TERMINAL_AND_QR" },
    });
    expect(model.reader.capability).toBe("TERMINAL_AND_QR");
    expect(model.payment.canChooseTerminal).toBe(true);
    expect(model.payment.canChooseQr).toBe(true);
  });

  it("applies first-rail-wins to the presentation immediately", () => {
    const model = buildChargeursPresentationModel({
      ...base,
      reader: { readerState: "READY", capability: "TERMINAL_AND_QR" },
      localRail: "TERMINAL",
      localRailState: "CLAIMING",
    });
    expect(model.payment.rail).toBe("TERMINAL");
    expect(model.payment.canChooseTerminal).toBe(false);
    expect(model.payment.canChooseQr).toBe(false);
  });

  it("does not re-enable QR after an engaged Terminal loses the reader", () => {
    const model = buildChargeursPresentationModel({
      ...base,
      journeyState: "PAYMENT_IN_PROGRESS",
      reader: {
        readerState: "RECONNECTING",
        capability: "QR_ONLY",
        payment: { rail: "TERMINAL", railState: "ENGAGED", serverConfirmed: false },
      },
    });
    expect(model.reader.capability).toBe("QR_ONLY");
    expect(model.payment.rail).toBe("TERMINAL");
    expect(model.payment.canChooseQr).toBe(false);
  });

  it.each([
    [390, 844, "MOBILE", "MOBILE"],
    [820, 1180, "TABLET", "TABLET"],
    [1440, 900, "WEB", "DESKTOP"],
  ] as const)("uses the same model on non-native %s x %s surfaces", (width, height, kind, viewportClass) => {
    const model = buildChargeursPresentationModel({
      ...base,
      width,
      height,
      nativeBridge: false,
      reader: { readerState: "READY", capability: "TERMINAL_AND_QR" },
    });
    expect(model.surface.kind).toBe(kind);
    expect(model.surface.viewportClass).toBe(viewportClass);
    expect(model.reader.state).toBe("UNAVAILABLE");
    expect(model.reader.capability).toBe("QR_ONLY");
    expect(model.payment.canChooseTerminal).toBe(false);
    expect(model.payment.canChooseQr).toBe(true);
  });

  it("maps backend recovery-required to canonical RECOVERY without inventing success", () => {
    const model = buildChargeursPresentationModel({
      ...base,
      journeyState: "PAYMENT_IN_PROGRESS",
      reader: {
        readerState: "READY",
        capability: "TERMINAL_AND_QR",
        payment: {
          rail: "TERMINAL",
          railState: "RECOVERY_REQUIRED",
          recoveryRequired: true,
          serverConfirmed: false,
        },
      },
    });
    expect(model.journey.state).toBe("RECOVERY");
    expect(model.payment.serverConfirmed).toBe(false);
    expect(model.visuals.sceneCue).toBe("RECOVERY");
  });
});
