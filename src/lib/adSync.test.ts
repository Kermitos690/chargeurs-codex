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

  it("does not let variable request/backend duration skew the server clock offset", () => {
    const serverNow = 2_000_000;
    const responseReceived = 1_000_250;

    expect(estimateServerClockOffsetMs(serverNow, 999_000, responseReceived)).toBe(999_750);
    expect(estimateServerClockOffsetMs(serverNow, 995_000, responseReceived)).toBe(999_750);
  });

  it("normalizes different Android local clocks onto the same server timeline", () => {
    const serverA = 5_000_000;
    const localReceiveA = 4_000_000;
    const serverB = 5_000_040;
    const localReceiveB = 3_970_040; // second kiosk clock is 30 seconds behind

    const offsetA = estimateServerClockOffsetMs(serverA, 3_999_000, localReceiveA);
    const offsetB = estimateServerClockOffsetMs(serverB, 3_968_000, localReceiveB);

    expect(localReceiveA + offsetA).toBe(serverA);
    expect(localReceiveB + offsetB).toBe(serverB);
  });
});