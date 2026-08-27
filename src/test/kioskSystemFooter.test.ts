import { describe, expect, it } from "vitest";
import { kioskFooterConnectionState } from "@/components/kiosk/KioskSystemFooter";

describe("kiosk footer connection semantics", () => {
  it("shows authentication recovery separately from network failure", () => {
    expect(kioskFooterConnectionState({
      networkOffline: false,
      backendState: "auth",
    })).toBe("auth");
  });

  it("uses limited only for a reachable network with a backend error", () => {
    expect(kioskFooterConnectionState({
      networkOffline: false,
      backendState: "error",
    })).toBe("limited");
  });

  it("keeps a real offline state authoritative", () => {
    expect(kioskFooterConnectionState({
      networkOffline: true,
      backendState: "auth",
    })).toBe("offline");
  });
});
