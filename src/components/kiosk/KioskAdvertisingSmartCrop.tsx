import { Component, useEffect, type ErrorInfo, type ReactNode } from "react";
import { estimateAdFocalPoint } from "@/lib/adFocalPoint";
import "./kiosk-advertising-smart-crop.css";

type BoundaryState = { failed: boolean };

class AdvertisingSmartCropBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Chargeurs Ads smart crop disabled after isolated error", error.message, info.componentStack);
  }

  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

function SmartCropRuntime() {
  useEffect(() => {
    let disposed = false;
    let activeSignature = "";

    const clear = (split?: HTMLElement | null) => {
      if (!split) return;
      try {
        delete split.dataset.smartLandscape;
        delete split.dataset.smartCrop;
        split.style.removeProperty("--kiosk-ad-focus-x");
        split.style.removeProperty("--kiosk-ad-focus-y");
      } catch {
        // Ads enhancement only. Never propagate to the kiosk shell.
      }
    };

    const apply = async () => {
      try {
        const split = document.querySelector<HTMLElement>(".kiosk-ad-split");
        if (!split) {
          activeSignature = "";
          return;
        }

        const media = split.querySelector<HTMLImageElement | HTMLVideoElement>(".kiosk-ad-media");
        if (!media) {
          clear(split);
          activeSignature = "";
          return;
        }

        split.dataset.smartLandscape = "true";

        if (!(media instanceof HTMLImageElement)) {
          split.dataset.smartCrop = "center";
          split.style.setProperty("--kiosk-ad-focus-x", "50%");
          split.style.setProperty("--kiosk-ad-focus-y", "50%");
          activeSignature = `video:${media.currentSrc || media.src}`;
          return;
        }

        const source = media.currentSrc || media.src;
        if (!source) return;
        const signature = `image:${source}`;
        if (signature === activeSignature && split.dataset.smartCrop) return;
        activeSignature = signature;
        split.dataset.smartCrop = "pending";
        split.style.setProperty("--kiosk-ad-focus-x", "50%");
        split.style.setProperty("--kiosk-ad-focus-y", "50%");

        const focus = await estimateAdFocalPoint(source);
        if (disposed) return;
        const currentSplit = document.querySelector<HTMLElement>(".kiosk-ad-split");
        const currentMedia = currentSplit?.querySelector<HTMLImageElement>("img.kiosk-ad-media");
        const currentSource = currentMedia?.currentSrc || currentMedia?.src || "";
        if (!currentSplit || currentSource !== source) return;

        currentSplit.dataset.smartLandscape = "true";
        currentSplit.dataset.smartCrop = focus.source;
        currentSplit.style.setProperty("--kiosk-ad-focus-x", `${focus.x.toFixed(1)}%`);
        currentSplit.style.setProperty("--kiosk-ad-focus-y", `${focus.y.toFixed(1)}%`);
      } catch (error) {
        console.error("Chargeurs Ads smart crop disabled after async error", error instanceof Error ? error.message : "UNKNOWN_ERROR");
        const split = document.querySelector<HTMLElement>(".kiosk-ad-split");
        if (split) {
          split.dataset.smartLandscape = "true";
          split.dataset.smartCrop = "fallback";
          split.style.setProperty("--kiosk-ad-focus-x", "50%");
          split.style.setProperty("--kiosk-ad-focus-y", "50%");
        }
      }
    };

    void apply();
    const observer = new MutationObserver(() => void apply());
    try {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["src", "class", "data-has-partner-qr"],
      });
    } catch {
      // The crop enhancement can silently disappear; the Ads player stays alive.
    }
    const timer = window.setInterval(() => void apply(), 850);

    return () => {
      disposed = true;
      observer.disconnect();
      window.clearInterval(timer);
      clear(document.querySelector<HTMLElement>(".kiosk-ad-split"));
    };
  }, []);

  return null;
}

export function KioskAdvertisingSmartCrop() {
  return (
    <AdvertisingSmartCropBoundary>
      <SmartCropRuntime />
    </AdvertisingSmartCropBoundary>
  );
}
