import { describe, expect, it } from "vitest";
import { shouldShowKioskAuthGuard } from "@/components/kiosk/KioskV3AuthGuard";

describe("kiosk authentication fail-safe", () => {
  it("blocks when no runtime kiosk token is available", () => {
    expect(shouldShowKioskAuthGuard({
      runtimeTokenPresent: false,
      nativeWrapper: false,
      nativeSessionCredentialPresent: true,
      authenticationRejected: false,
    })).toBe(true);
  });

  it("blocks a native kiosk when the wrapper did not reinject its session credential", () => {
    expect(shouldShowKioskAuthGuard({
      runtimeTokenPresent: true,
      nativeWrapper: true,
      nativeSessionCredentialPresent: false,
      authenticationRejected: false,
    })).toBe(true);
  });

  it("blocks immediately after a server authentication rejection", () => {
    expect(shouldShowKioskAuthGuard({
      runtimeTokenPresent: true,
      nativeWrapper: true,
      nativeSessionCredentialPresent: true,
      authenticationRejected: true,
    })).toBe(true);
  });

  it("does not cover a correctly provisioned kiosk", () => {
    expect(shouldShowKioskAuthGuard({
      runtimeTokenPresent: true,
      nativeWrapper: true,
      nativeSessionCredentialPresent: true,
      authenticationRejected: false,
    })).toBe(false);
  });
});
