import { describe, expect, it } from "vitest";
import { calculateStationHealth } from "@/lib/stationHealth";

describe("calculateStationHealth", () => {
  const now = new Date("2026-07-15T12:00:00.000Z");

  it("returns a healthy score for a synchronized operational station", () => {
    const result = calculateStationHealth({
      online: true,
      configured: true,
      lastSyncAt: "2026-07-15T11:59:30.000Z",
      rentableCount: 5,
      returnableCount: 3,
      totalCount: 8,
      now,
    });

    expect(result.score).toBe(100);
    expect(result.status).toBe("healthy");
  });

  it("marks an offline unconfigured station as offline", () => {
    const result = calculateStationHealth({
      online: false,
      configured: false,
      lastSyncAt: null,
      rentableCount: 0,
      returnableCount: 0,
      totalCount: 8,
      activeIncidentCount: 2,
      now,
    });

    expect(result.score).toBe(0);
    expect(result.status).toBe("offline");
    expect(result.reasons).toContain("Borne hors ligne");
  });

  it("degrades a station with stale synchronization", () => {
    const result = calculateStationHealth({
      online: true,
      configured: true,
      lastSyncAt: "2026-07-15T11:50:00.000Z",
      rentableCount: 2,
      returnableCount: 2,
      totalCount: 8,
      now,
    });

    expect(result.status).toBe("degraded");
    expect(result.lastSyncAgeSeconds).toBe(600);
  });
});
