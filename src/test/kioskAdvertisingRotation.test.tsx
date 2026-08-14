import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAdRotation } from "@/components/kiosk/KioskAdvertisingLayer";

vi.mock("@/lib/kioskFetch", () => ({ readKioskToken: () => null }));
vi.mock("@/lib/kioskEdgeProxy", () => ({ invokeKioskEdgeProxy: vi.fn() }));

const imageEntries = [
  {
    key: "campaign:item-1",
    campaignId: "campaign",
    campaignName: "Campaign",
    splitRatio: 0.35,
    item: {
      id: "item-1",
      assetId: "asset-1",
      title: "Image 1",
      mediaType: "image",
      mimeType: "image/png",
      url: "https://example.invalid/1.png",
      imageDurationSeconds: 2,
      mediaDurationSeconds: null,
      sortOrder: 0,
    },
  },
  {
    key: "campaign:item-2",
    campaignId: "campaign",
    campaignName: "Campaign",
    splitRatio: 0.35,
    item: {
      id: "item-2",
      assetId: "asset-2",
      title: "Image 2",
      mediaType: "image",
      mimeType: "image/png",
      url: "https://example.invalid/2.png",
      imageDurationSeconds: 2,
      mediaDurationSeconds: null,
      sortOrder: 1,
    },
  },
] as any;

describe("kiosk advertising rotation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("advances a screensaver image even when no image load event is delivered", () => {
    const { result, unmount } = renderHook(() =>
      useAdRotation(imageEntries, true, "screensaver", "", "playlist-v1"),
    );

    expect(result.current.current?.key).toBe("campaign:item-1");

    act(() => {
      vi.advanceTimersByTime(1_999);
    });
    expect(result.current.current?.key).toBe("campaign:item-1");

    // Intentionally never call result.current.markStarted(): rotation must be
    // driven by the player timer, not by React's image onLoad event.
    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(result.current.current?.key).toBe("campaign:item-2");
    unmount();
  });
});
