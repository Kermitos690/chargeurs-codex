import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearLockedStation, forceSetStation, getLockedStation } from "@/lib/kioskLock";
import { resolveKioskIdentity, stationHasPaymentTerminal } from "@/lib/kioskIdentity";

type TestWindow = Window & {
  ChargeursNative?: { getStationBinding: () => string };
};

function bindNative(stationId: string, deviceId: string) {
  (window as TestWindow).ChargeursNative = {
    getStationBinding: () => JSON.stringify({ stationId, deviceId }),
  };
}

beforeEach(() => {
  clearLockedStation();
  delete (window as TestWindow).ChargeursNative;
});

afterEach(() => {
  clearLockedStation();
  delete (window as TestWindow).ChargeursNative;
});

describe("kiosk canonical identity", () => {
  it("repairs the mis-provisioned physical DTA22032 device even when native reports DTA21269", () => {
    forceSetStation("DTA21269");
    bindNative("DTA21269", "aceb691f-e88d-4332-b667-b53ad313a832");

    const identity = resolveKioskIdentity("DTA21269");

    expect(identity.nativeStationId).toBe("DTA21269");
    expect(identity.stationId).toBe("DTA22032");
    expect(identity.redirectTo).toBe("/kiosk/DTA22032");
    expect(identity.terminalAvailable).toBe(false);
    expect(getLockedStation()).toBe("DTA22032");
  });

  it("keeps DTA21269 QR/client-only when no Terminal is attached", () => {
    bindNative("DTA21269", "8d9c5a0b-c15f-43b5-be76-5ed75b2607f6");

    const identity = resolveKioskIdentity("DTA21269");

    expect(identity.stationId).toBe("DTA21269");
    expect(identity.redirectTo).toBeNull();
    expect(identity.terminalAvailable).toBe(false);
    expect(getLockedStation()).toBe("DTA21269");
  });

  it("keeps DTA21277 separate and without terminal", () => {
    bindNative("DTA21277", "c1651928-082d-4220-a4dc-77e9532ae8a2");

    const identity = resolveKioskIdentity("DTA21277");

    expect(identity.stationId).toBe("DTA21277");
    expect(identity.redirectTo).toBeNull();
    expect(identity.terminalAvailable).toBe(false);
  });

  it("exposes the dedicated Terminal lane on DTA21270 only", () => {
    bindNative("DTA21270", "dta21270-terminal-device");
    const identity = resolveKioskIdentity("DTA21270");
    expect(identity.stationId).toBe("DTA21270");
    expect(identity.terminalAvailable).toBe(true);
  });

  it("does not fall back to DTA21269 for an invalid station", () => {
    const identity = resolveKioskIdentity("DTA00000");

    expect(identity.stationId).toBeNull();
    expect(identity.error).toBe("STATION_NOT_IN_PILOT_FLEET");
    expect(identity.terminalAvailable).toBe(false);
    expect(getLockedStation()).toBeNull();
  });

  it("does not fall back to DTA21269 when station identity is missing", () => {
    const identity = resolveKioskIdentity(null);

    expect(identity.stationId).toBeNull();
    expect(identity.error).toBe("STATION_MISSING");
    expect(identity.terminalAvailable).toBe(false);
  });

  it("exposes terminal capability only for DTA21270", () => {
    expect(stationHasPaymentTerminal("DTA21269")).toBe(false);
    expect(stationHasPaymentTerminal("DTA21270")).toBe(true);
    expect(stationHasPaymentTerminal("DTA21277")).toBe(false);
    expect(stationHasPaymentTerminal("DTA22032")).toBe(false);
  });
});
