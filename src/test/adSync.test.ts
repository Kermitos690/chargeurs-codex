import { describe, expect, it } from "vitest";
import { adEntryDurationMs, estimateServerClockOffsetMs, resolveAdSyncPosition } from "@/lib/adSync";

const entries = [
  { item: { mediaType: "image" as const, imageDurationSeconds: 8 } },
  { item: { mediaType: "image" as const, imageDurationSeconds: 6 } },
  { item: { mediaType: "video" as const, mediaDurationSeconds: 10 } },
];

describe("Advertising shared timeline", () => {
  it("maps every kiosk to the same media index for the same shared clock", () => {
    expect(resolveAdSyncPosition(entries, 0)).toMatchObject({ index: 0, elapsedMs: 0, remainingMs: 8000, cycleMs: 24000 });
    expect(resolveAdSyncPosition(entries, 7999)?.index).toBe(0);
    expect(resolveAdSyncPosition(entries, 8000)).toMatchObject({ index: 1, elapsedMs: 0, remainingMs: 6000 });
    expect(resolveAdSyncPosition(entries, 13999)?.index).toBe(1);
    expect(resolveAdSyncPosition(entries, 14000)).toMatchObject({ index: 2, elapsedMs: 0, remainingMs: 10000 });
    expect(resolveAdSyncPosition(entries, 24000)?.index).toBe(0);
  });

  it("supports a stable epoch and wraps negative phases", () => {
    expect(resolveAdSyncPosition(entries, 1000, 1000)?.index).toBe(0);
    expect(resolveAdSyncPosition(entries, 500, 1000)?.index).toBe(2);
  });

  it("uses a network midpoint to estimate server clock offset", () => {
    expect(estimateServerClockOffsetMs(11_050, 10_000, 10_100)).toBe(1_000);
  });

  it("clamps pathological media durations", () => {
    expect(adEntryDurationMs({ item: { mediaType: "image", imageDurationSeconds: 0 } })).toBe(8000);
    expect(adEntryDurationMs({ item: { mediaType: "image", imageDurationSeconds: 1 } })).toBe(2000);
    expect(adEntryDurationMs({ item: { mediaType: "video", mediaDurationSeconds: 999 } })).toBe(300000);
  });
});
