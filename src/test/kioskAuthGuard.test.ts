import { describe, expect, it } from "vitest";
import {
  shouldAttemptNativeAuthRecovery,
  shouldShowKioskAuthGuard,
} from "@/components/kiosk/KioskV3AuthGuard";

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

  it("requests one native restart when the native credential disappeared", () => {
    expect(shouldAttemptNativeAuthRecovery({
      guardActive: true,
      nativeWrapper: true,
      nativeSessionCredentialPresent: false,
      restartAvailable: true,
      recentlyAttempted: false,
    })).toBe(true);
  });

  it("does not restart when recovery was already attempted", () => {
    expect(shouldAttemptNativeAuthRecovery({
      guardActive: true,
      nativeWrapper: true,
      nativeSessionCredentialPresent: false,
      restartAvailable: true,
      recentlyAttempted: true,
    })).toBe(false);
  });

  it("does not weaken auth when the native restart bridge is unavailable", () => {
    expect(shouldAttemptNativeAuthRecovery({
      guardActive: true,
      nativeWrapper: true,
      nativeSessionCredentialPresent: false,
      restartAvailable: false,
      recentlyAttempted: false,
    })).toBe(false);
  });
});
