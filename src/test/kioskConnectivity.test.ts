import { describe, expect, it } from "vitest";
import { kioskTransportUnavailable } from "@/lib/kioskConnectivity";

describe("kiosk connectivity policy", () => {
  it("does not block an Android WebView false offline hint after a server health response", () => {
    expect(kioskTransportUnavailable("offline", true)).toBe(false);
    expect(kioskTransportUnavailable("offline", null)).toBe(false);
  });

  it("still blocks when the browser reports offline and no server response is available", () => {
    expect(kioskTransportUnavailable("offline", false)).toBe(true);
    expect(kioskTransportUnavailable("online", false)).toBe(false);
  });
});
