import { afterEach, describe, expect, it, vi } from "vitest";

const realtimeMock = vi.hoisted(() => {
  const subscribe = vi.fn();
  const on = vi.fn();
  const channel = { on, subscribe };
  on.mockReturnValue(channel);
  subscribe.mockReturnValue(channel);
  return {
    channel,
    createChannel: vi.fn(() => channel),
    removeChannel: vi.fn(),
    subscribe,
  };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: realtimeMock.createChannel,
    removeChannel: realtimeMock.removeChannel,
  },
}));

import {
  __resetKioskEdgeProxyStateForTests,
  invalidateKioskReturnSummaryCache,
  invokeKioskEdgeProxy,
  kioskReadRetryDelayMs,
} from "@/lib/kioskEdgeProxy";

describe("kiosk Edge proxy", () => {
  afterEach(() => {
    __resetKioskEdgeProxyStateForTests();
    window.localStorage.clear();
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("uses the same-origin kiosk relay and preserves the station-bound headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await invokeKioskEdgeProxy<{ ok: boolean }>(
      "/api/kiosk/create-rental-session",
      { stationId: "DTA21269", language: "fr" },
      { "X-Kiosk-Token": "kt_test", "X-Idempotency-Key": "intent-12345678" },
    );

    expect(result).toMatchObject({
      data: { ok: true },
      transportError: false,
      status: 200,
      authError: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/kiosk/create-rental-session",
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
        headers: expect.objectContaining({
          "X-Kiosk-Token": "kt_test",
          "X-Idempotency-Key": "intent-12345678",
        }),
      }),
    );
  });

  it("suppresses repeated cacheable reads after Supabase returns 402", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Payment Required" }), {
      status: 402,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const first = await invokeKioskEdgeProxy(
      "/api/kiosk/ads-playlist",
      { action: "playlist", stationId: "DTA21269" },
      { "X-Kiosk-Token": "kt_test" },
    );
    const second = await invokeKioskEdgeProxy(
      "/api/kiosk/ads-playlist",
      { action: "playlist", stationId: "DTA21269" },
      { "X-Kiosk-Token": "kt_test" },
    );

    expect(first.status).toBe(402);
    expect(second.status).toBe(402);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not open Realtime while the corresponding kiosk read returns 402", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Payment Required" }), {
      status: 402,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await invokeKioskEdgeProxy(
      "/api/kiosk/return-summary",
      { stationId: "DTA21269" },
      { "X-Kiosk-Token": "kt_test" },
    );

    expect(realtimeMock.createChannel).not.toHaveBeenCalled();
  });

  it("retires a failed Realtime channel and does not immediately recreate it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, stage: "none" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await invokeKioskEdgeProxy(
      "/api/kiosk/return-summary",
      { stationId: "DTA21269" },
      { "X-Kiosk-Token": "kt_test" },
    );
    expect(realtimeMock.createChannel).toHaveBeenCalledTimes(1);

    const statusListener = realtimeMock.subscribe.mock.calls[0]?.[0] as ((status: string) => void) | undefined;
    statusListener?.("CHANNEL_ERROR");
    expect(realtimeMock.removeChannel).toHaveBeenCalledWith(realtimeMock.channel);

    invalidateKioskReturnSummaryCache("DTA21269");
    await invokeKioskEdgeProxy(
      "/api/kiosk/return-summary",
      { stationId: "DTA21269" },
      { "X-Kiosk-Token": "kt_test" },
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(realtimeMock.createChannel).toHaveBeenCalledTimes(1);
  });

  it("samples an Ads impression attempt even when Supabase returns 402", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Payment Required" }), {
      status: 402,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const impression = {
      action: "impression",
      stationId: "DTA21269",
      campaignId: "campaign-1",
      assetId: "asset-1",
      displayMode: "home",
    };

    const first = await invokeKioskEdgeProxy(
      "/api/kiosk/ads-playlist",
      impression,
      { "X-Kiosk-Token": "kt_test" },
    );
    const second = await invokeKioskEdgeProxy<{ sampled?: boolean }>(
      "/api/kiosk/ads-playlist",
      impression,
      { "X-Kiosk-Token": "kt_test" },
    );

    expect(first.status).toBe(402);
    expect(second).toMatchObject({ status: 200, data: { sampled: true } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a suppressed read after the 402 backoff expires and clears on success", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-29T03:00:00Z"));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Payment Required" }), {
        status: 402,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, campaigns: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await invokeKioskEdgeProxy(
      "/api/kiosk/ads-playlist",
      { action: "playlist", stationId: "DTA21269" },
      { "X-Kiosk-Token": "kt_test" },
    );
    await vi.advanceTimersByTimeAsync(60_001);
    const recovered = await invokeKioskEdgeProxy<{ ok: boolean }>(
      "/api/kiosk/ads-playlist",
      { action: "playlist", stationId: "DTA21269" },
      { "X-Kiosk-Token": "kt_test" },
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(recovered).toMatchObject({ status: 200, data: { ok: true } });
  });

  it("uses bounded exponential delays for quota, rate-limit and server failures", () => {
    expect(kioskReadRetryDelayMs(402, 1)).toBe(60_000);
    expect(kioskReadRetryDelayMs(402, 2)).toBe(120_000);
    expect(kioskReadRetryDelayMs(402, 8)).toBe(600_000);
    expect(kioskReadRetryDelayMs(429, 1)).toBe(5_000);
    expect(kioskReadRetryDelayMs(429, 8)).toBe(120_000);
    expect(kioskReadRetryDelayMs(503, 1)).toBe(2_000);
    expect(kioskReadRetryDelayMs(null, 8)).toBe(30_000);
    expect(kioskReadRetryDelayMs(400, 1)).toBe(0);
  });
});
