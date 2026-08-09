import { afterEach, describe, expect, it, vi } from "vitest";
import { invokeKioskEdgeProxy } from "@/lib/kioskEdgeProxy";

describe("kiosk Edge proxy", () => {
  afterEach(() => vi.unstubAllGlobals());

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

    expect(result).toEqual({ data: { ok: true }, transportError: false });
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
});
