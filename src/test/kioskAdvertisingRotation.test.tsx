import { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAdRotation } from "@/components/kiosk/KioskAdvertisingLayer";

vi.mock("@/lib/kioskFetch", () => ({ readKioskToken: () => null }));
vi.mock("@/lib/kioskEdgeProxy", () => ({ invokeKioskEdgeProxy: vi.fn() }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
    let currentKey: string | null = null;

    function RotationHarness() {
      const rotation = useAdRotation(imageEntries, true, "screensaver", "", "playlist-v1");
      useLayoutEffect(() => {
        currentKey = rotation.current?.key ?? null;
      }, [rotation.current?.key]);
      return null;
    }

    const container = document.createElement("div");
    const root = createRoot(container);

    act(() => {
      root.render(<RotationHarness />);
    });
    expect(currentKey).toBe("campaign:item-1");

    act(() => {
      vi.advanceTimersByTime(1_999);
    });
    expect(currentKey).toBe("campaign:item-1");

    // No media-start callback is fired here. The player lifecycle must arm the
    // image timer independently from React/WebView image load delivery.
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(currentKey).toBe("campaign:item-2");

    act(() => {
      root.unmount();
    });
  });
});
