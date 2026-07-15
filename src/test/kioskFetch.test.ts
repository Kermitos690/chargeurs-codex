import { describe, expect, it } from "vitest";
import { buildKioskAwareRequestInit, isKioskCabinetSyncRequest } from "@/lib/kioskFetch";

describe("kiosk-aware Edge Function transport", () => {
  const syncUrl = "https://example.supabase.co/functions/v1/sync-cabinet-status";

  it("recognizes only the cabinet synchronization function", () => {
    expect(isKioskCabinetSyncRequest(syncUrl)).toBe(true);
    expect(isKioskCabinetSyncRequest("https://example.supabase.co/functions/v1/create-stripe-checkout")).toBe(false);
    expect(isKioskCabinetSyncRequest("https://example.supabase.co/rest/v1/stations")).toBe(false);
  });

  it("adds the kiosk token only to the cabinet synchronization request", () => {
    const init = buildKioskAwareRequestInit(syncUrl, { method: "POST" }, () => "kt_test_token_with_enough_entropy");
    const headers = new Headers(init.headers);
    expect(headers.get("X-Kiosk-Token")).toBe("kt_test_token_with_enough_entropy");

    const unrelated = buildKioskAwareRequestInit(
      "https://example.supabase.co/functions/v1/create-stripe-checkout",
      { method: "POST" },
      () => "kt_test_token_with_enough_entropy",
    );
    expect(new Headers(unrelated.headers).has("X-Kiosk-Token")).toBe(false);
  });

  it("does not overwrite an explicitly supplied kiosk token", () => {
    const init = buildKioskAwareRequestInit(
      syncUrl,
      { headers: { "X-Kiosk-Token": "kt_explicit" } },
      () => "kt_local_storage",
    );
    expect(new Headers(init.headers).get("X-Kiosk-Token")).toBe("kt_explicit");
  });

  it("stays fail-closed when no token is available", () => {
    const init = buildKioskAwareRequestInit(syncUrl, { method: "POST" }, () => null);
    expect(new Headers(init.headers).has("X-Kiosk-Token")).toBe(false);
  });
});
