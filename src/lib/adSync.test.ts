import { afterEach, describe, expect, it } from "vitest";
import {
  estimateNetworkClockSample,
  estimateServerClockOffsetMs,
  resolveAdSyncPosition,
  selectStableClockOffsetMs,
  setAuthoritativeAdsClockOffsetMs,
} from "./adSync";

const entries = [
  { item: { mediaType: "image" as const, imageDurationSeconds: 8 } },
  { item: { mediaType: "image" as const, imageDurationSeconds: 8 } },
  { item: { mediaType: "image" as const, imageDurationSeconds: 8 } },
  { item: { mediaType: "image" as const, imageDurationSeconds: 8 } },
];

afterEach(() => setAuthoritativeAdsClockOffsetMs(null));

describe("network advertising clock", () => {
  it("selects the same media from the same shared wall-clock regardless of kiosk boot time", () => {
    const sharedNow = 1_786_758_900_250;
    expect(resolveAdSyncPosition(entries, sharedNow, 0)?.index)
      .toBe(resolveAdSyncPosition(entries, sharedNow, 0)?.index);

    const position = resolveAdSyncPosition(entries, sharedNow, 0);
    expect(position?.cycleMs).toBe(32_000);
    expect(position?.remainingMs).toBeGreaterThan(0);
  });

  it("keeps the playlist midpoint estimate as a safe fallback", () => {
    const serverNow = 2_000_000;
    expect(estimateServerClockOffsetMs(serverNow, 999_000, 1_001_000)).toBe(1_000_000);
    expect(estimateServerClockOffsetMs(serverNow, 998_000, 1_002_000)).toBe(1_000_000);
  });

  it("calculates an NTP-style offset while removing server processing time", () => {
    const sample = estimateNetworkClockSample(1_000_000, 2_000_120, 2_000_140, 1_000_220);
    expect(sample).toEqual({ offsetMs: 1_000_020, rttMs: 200 });
  });

  it("rejects slow outliers and uses the median of the lowest-latency samples", () => {
    const selected = selectStableClockOffsetMs([
      { offsetMs: 1_000_010, rttMs: 80 },
      { offsetMs: 999_995, rttMs: 70 },
      { offsetMs: 1_000_005, rttMs: 90 },
      { offsetMs: 1_004_000, rttMs: 900 },
      { offsetMs: 995_000, rttMs: 1_100 },
    ]);
    expect(selected).toBe(1_000_005);
  });

  it("normalizes different Android clocks onto the same shared time", () => {
    const a = estimateNetworkClockSample(4_000_000, 5_000_050, 5_000_060, 4_000_110);
    const b = estimateNetworkClockSample(3_970_000, 5_000_040, 5_000_050, 3_970_100);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(Math.abs((4_000_055 + Number(a?.offsetMs)) - (3_970_050 + Number(b?.offsetMs)))).toBeLessThanOrEqual(15);
  });

  it("makes the dedicated fleet clock override a noisier playlist estimate", () => {
    setAuthoritativeAdsClockOffsetMs(1_234);
    expect(estimateServerClockOffsetMs(9_000, 1_000, 6_000)).toBe(1_234);
  });
});
