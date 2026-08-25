import { describe, expect, it } from "vitest";
import {
  buildKioskAwareRequestInit,
  isKioskCabinetSyncRequest,
  isKioskQuoteRequest,
  isSafeKioskQuote,
} from "@/lib/kioskFetch";

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

  it("accepts the current Premium Guest tiered quote", () => {
    expect(isSafeKioskQuote({
      currency: "CHF",
      customer_segment: "guest",
      tiered: true,
      period_minutes: 30,
      price_per_period_cents: 790,
      final_cents: 190,
      deposit_cents: 3_000,
      total_cap_cents: 3_000,
      tiers: [
        { upper_minutes: 30, total_cents: 190 },
        { upper_minutes: 120, total_cents: 390 },
        { upper_minutes: 360, total_cents: 590 },
        { upper_minutes: 1440, total_cents: 790 },
      ],
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
