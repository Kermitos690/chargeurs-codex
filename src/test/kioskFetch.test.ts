import { beforeEach, describe, expect, it } from "vitest";
import {
  buildKioskAwareRequestInit,
  isKioskCabinetSyncRequest,
  isKioskQuoteRequest,
  isSafeKioskQuote,
  readKioskToken,
} from "@/lib/kioskFetch";

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

describe("kiosk credential storage", () => {
  it("rejects and clears a legacy pairing code stored as a kiosk token", () => {
    localStorage.setItem("kiosk_token", "kc_u0jDsw9_example_pairing_code");
    expect(readKioskToken()).toBeNull();
    expect(localStorage.getItem("kiosk_token")).toBeNull();
  });

  it("prefers the native session token and accepts only kt_ credentials", () => {
    localStorage.setItem("kiosk_token", "kt_local_fallback_token_1234567890");
    sessionStorage.setItem("kiosk_token", "kt_native_session_token_123456789");
    expect(readKioskToken()).toBe("kt_native_session_token_123456789");
  });
});

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

describe("kiosk quote safety guard", () => {
  const quoteUrl = "https://example.supabase.co/rest/v1/rpc/kiosk_quote";

  it("recognizes only the kiosk quote RPC", () => {
    expect(isKioskQuoteRequest(quoteUrl)).toBe(true);
    expect(isKioskQuoteRequest("https://example.supabase.co/rest/v1/rpc/compute_pricing")).toBe(false);
  });

  it("accepts the confirmed beta upfront quote", () => {
    expect(isSafeKioskQuote({
      currency: "CHF",
      period_minutes: 30,
      duration_cents: 75,
      price_per_period_cents: 75,
      final_cents: 75,
      deposit_cents: 3_000,
      daily_cap_cents: 1_800,
      unreturned_fee_cents: 9_900,
    })).toBe(true);
  });

  it("rejects the legacy 0.50 CHF quote and incomplete profiles", () => {
    expect(isSafeKioskQuote({
      currency: "CHF",
      period_minutes: 30,
      duration_cents: 50,
      final_cents: 50,
      deposit_cents: 0,
    })).toBe(false);
    expect(isSafeKioskQuote({ error: "PRICING_NOT_CONFIGURED" })).toBe(false);
    expect(isSafeKioskQuote(null)).toBe(false);
  });
});