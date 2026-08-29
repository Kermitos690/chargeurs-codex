import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetKioskAwareFetchStateForTests,
  buildKioskAwareRequestInit,
  isKioskCabinetSyncRequest,
  isKioskQuoteRequest,
  isQuotaProtectedKioskRead,
  isSafeKioskQuote,
  kioskAwareFetch,
  kioskReadTransportRetryDelayMs,
} from "@/lib/kioskFetch";

afterEach(() => {
  __resetKioskAwareFetchStateForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
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

describe("quota-aware kiosk read transport", () => {
  const statusUrl = "https://example.supabase.co/rest/v1/rpc/kiosk_session_status";
  const stationsUrl = "https://example.supabase.co/rest/v1/stations?station_id=eq.DTA21269";

  it("protects only known read-only kiosk requests", () => {
    expect(isQuotaProtectedKioskRead(statusUrl, { method: "POST" })).toBe(true);
    expect(isQuotaProtectedKioskRead("https://example.supabase.co/rest/v1/rpc/kiosk_quote", { method: "POST" })).toBe(true);
    expect(isQuotaProtectedKioskRead(stationsUrl, { method: "GET" })).toBe(true);
    expect(isQuotaProtectedKioskRead("https://example.supabase.co/functions/v1/create-stripe-checkout", { method: "POST" })).toBe(false);
    expect(isQuotaProtectedKioskRead("https://example.supabase.co/rest/v1/rentals", { method: "POST" })).toBe(false);
  });

  it("suppresses repeated 402 network calls for the 700ms session-status poll", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "Payment Required" }), {
      status: 402,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const first = await kioskAwareFetch(statusUrl, { method: "POST", body: "{}" });
    const second = await kioskAwareFetch(statusUrl, { method: "POST", body: "{}" });

    expect(first.status).toBe(402);
    expect(second.status).toBe(402);
    expect(await second.json()).toEqual({ message: "Payment Required" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("allows a fresh session-status read after the quota backoff expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-29T03:00:00Z"));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "Payment Required" }), {
        status: 402,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: "paid" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await kioskAwareFetch(statusUrl, { method: "POST", body: "{}" });
    await vi.advanceTimersByTimeAsync(60_001);
    const recovered = await kioskAwareFetch(statusUrl, { method: "POST", body: "{}" });

    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toEqual({ state: "paid" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses bounded retry delays for quota, rate-limit and server responses", () => {
    expect(kioskReadTransportRetryDelayMs(402, 1)).toBe(60_000);
    expect(kioskReadTransportRetryDelayMs(402, 8)).toBe(600_000);
    expect(kioskReadTransportRetryDelayMs(429, 1)).toBe(5_000);
    expect(kioskReadTransportRetryDelayMs(429, 8)).toBe(120_000);
    expect(kioskReadTransportRetryDelayMs(503, 1)).toBe(2_000);
    expect(kioskReadTransportRetryDelayMs(503, 8)).toBe(30_000);
    expect(kioskReadTransportRetryDelayMs(400, 1)).toBe(0);
  });
});
