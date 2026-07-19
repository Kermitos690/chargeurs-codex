import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearLockedStation,
  forceSetStation,
  getLockedStation,
  isValidStationId,
  lockStationIfUnset,
} from "@/lib/kioskLock";

beforeEach(() => {
  clearLockedStation();
});

afterEach(() => {
  clearLockedStation();
});

describe("kioskLock", () => {
  it("validates station ids strictly", () => {
    expect(isValidStationId("DTA21269")).toBe(true);
    expect(isValidStationId("DTA-21269")).toBe(true);
    expect(isValidStationId("dta_21269")).toBe(true);
    expect(isValidStationId("")).toBe(false);
    expect(isValidStationId(null)).toBe(false);
    expect(isValidStationId("abc")).toBe(false);
    expect(isValidStationId("../etc/passwd")).toBe(false);
    expect(isValidStationId("a".repeat(64))).toBe(false);
  });

  it("locks the station on first write and stays idempotent afterwards", () => {
    expect(lockStationIfUnset("DTA21269")).toBe("DTA21269");
    expect(getLockedStation()).toBe("DTA21269");
    // Subsequent calls with a different id must not silently rebind.
    expect(lockStationIfUnset("DTA22032")).toBe("DTA21269");
    expect(getLockedStation()).toBe("DTA21269");
  });

  it("allows explicit operator override via forceSetStation", () => {
    lockStationIfUnset("DTA21269");
    forceSetStation("DTA22032");
    expect(getLockedStation()).toBe("DTA22032");
  });

  it("ignores invalid ids in forceSetStation", () => {
    lockStationIfUnset("DTA21269");
    forceSetStation("bad");
    expect(getLockedStation()).toBe("DTA21269");
  });
});
