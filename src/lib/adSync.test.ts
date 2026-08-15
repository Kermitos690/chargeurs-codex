import { describe, expect, it } from "vitest";
import { estimateServerClockOffsetMs, resolveAdSyncPosition } from "./adSync";

const entries = [
  { item: { mediaType: "image" as const, imageDurationSeconds: 8 } },
  { item: { mediaType: "image" as const, imageDurationSeconds: 8 } },
  { item: { mediaType: "image" as const, imageDurationSeconds: 8 } },
  { item: { mediaType: "image" as const, imageDurationSeconds: 8 } },
];

describe("network advertising clock", () => {
  it("selects the same media from the same shared wall-clock regardless of kiosk boot time", () => {
    const sharedNow = 1_786_758_900_250;
    expect(resolveAdSyncPosition(entries, sharedNow, 0)?.index)
      .toBe(resolveAdSyncPosition(entries, sharedNow, 0)?.index);

    const position = resolveAdSyncPosition(entries, sharedNow, 0);
    expect(position?.cycleMs).toBe(32_000);
    expect(position?.remainingMs).toBeGreaterThan(0);
  });

  it("compensates half of the observed request round-trip time", () => {
    const serverNow = 2_000_000;
    expect(estimateServerClockOffsetMs(serverNow, 999_000, 1_001_000)).toBe(1_000_000);
    expect(estimateServerClockOffsetMs(serverNow, 998_000, 1_002_000)).toBe(1_000_000);
  });

  it("normalizes different Android clocks when their RTT is equivalent", () => {
    const serverNow = 5_000_000;
    const offsetA = estimateServerClockOffsetMs(serverNow, 3_999_000, 4_001_000);
    const offsetB = estimateServerClockOffsetMs(serverNow, 3_969_000, 3_971_000);

    expect(4_000_000 + offsetA).toBe(serverNow);
    expect(3_970_000 + offsetB).toBe(serverNow);
  });
});
