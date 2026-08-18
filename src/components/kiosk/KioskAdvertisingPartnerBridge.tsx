import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useParams } from "react-router-dom";
import { useI18n } from "@/i18n/i18n";
import { KioskAdvertisingPartnerPanel } from "./KioskAdvertisingPartnerPanel";

const CACHE_PREFIX = "chargeurs:ads:playlist:";

type CachedItem = {
  id?: string;
  assetId?: string;
  title?: string;
  url?: string;
  qrDestinationUrl?: string | null;
  ctaLabel?: string | null;
};

type CachedCampaign = {
  id?: string;
  name?: string;
  qrUrl?: string | null;
  items?: CachedItem[];
};

type CachedPlaylist = {
  campaigns?: CachedCampaign[];
};

type BridgeState = {
  key: string;
  target: HTMLElement;
  mode: "split" | "screensaver";
  qrUrl: string;
  campaignName: string;
  destinationUrl: string | null;
  ctaLabel: string | null;
};

type BoundaryState = { failed: boolean };

class AdvertisingPartnerBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Chargeurs partner QR panel disabled after isolated Ads error", error.message, info.componentStack);
  }

  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

function normalizeUrl(value: string) {
  try {
    const url = new URL(value, window.location.origin);
    url.hash = "";
    return url.toString();
  } catch {
    return value;
  }
}

function readCachedPlaylist(stationId: string): CachedPlaylist | null {
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${stationId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedPlaylist;
    return Array.isArray(parsed.campaigns) ? parsed : null;
  } catch {
    return null;
  }
}

function currentSurface(): { target: HTMLElement; mode: "split" | "screensaver" } | null {
  const saver = document.querySelector<HTMLElement>(".kiosk-ad-screensaver");
  if (saver) {
    const rect = saver.getBoundingClientRect();
    if (rect.width > 2 && rect.height > 2 && getComputedStyle(saver).visibility !== "hidden") {
      return { target: saver, mode: "screensaver" };
    }
  }

  const split = document.querySelector<HTMLElement>(".kiosk-ad-split");
  if (split) {
    const rect = split.getBoundingClientRect();
    if (rect.width > 2 && rect.height > 2 && getComputedStyle(split).visibility !== "hidden") {
      return { target: split, mode: "split" };
    }
  }

  return null;
}

function currentMedia(surface: HTMLElement) {
  const media = surface.querySelector<HTMLImageElement | HTMLVideoElement>(".kiosk-ad-media");
  if (!media) return { url: "", title: "" };
  const url = media.currentSrc || media.getAttribute("src") || "";
  const title = media instanceof HTMLImageElement
    ? media.alt
    : media.getAttribute("aria-label") || "";
  return { url, title };
}

function validTrackedQr(value?: string | null) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function KioskAdvertisingPartnerBridgeRuntime() {
  const { stationId = "" } = useParams();
  const { lang } = useI18n();
  const [bridge, setBridge] = useState<BridgeState | null>(null);
  const markedTargetRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!stationId) {
      setBridge(null);
      return;
    }

    const clearMarkedTarget = () => {
      if (markedTargetRef.current) {
        delete markedTargetRef.current.dataset.hasPartnerQr;
        markedTargetRef.current = null;
      }
    };

    const detect = () => {
      const surface = currentSurface();
      const cached = readCachedPlaylist(stationId);
      if (!surface || !cached) {
        clearMarkedTarget();
        setBridge(null);
        return;
      }

      const media = currentMedia(surface.target);
      const mediaUrl = normalizeUrl(media.url);
      let matchedCampaign: CachedCampaign | null = null;
      let matchedItem: CachedItem | null = null;

      for (const campaign of cached.campaigns ?? []) {
        for (const item of campaign.items ?? []) {
          const urlMatches = Boolean(media.url && item.url && normalizeUrl(item.url) === mediaUrl);
          const titleMatches = Boolean(media.title && item.title && media.title === item.title);
          if (urlMatches || titleMatches) {
            matchedCampaign = campaign;
            matchedItem = item;
            break;
          }
        }
        if (matchedCampaign) break;
      }

      const qrUrl = validTrackedQr(matchedCampaign?.qrUrl);
      if (!matchedCampaign || !matchedItem || !qrUrl) {
        clearMarkedTarget();
        setBridge(null);
        return;
      }

      if (markedTargetRef.current && markedTargetRef.current !== surface.target) {
        delete markedTargetRef.current.dataset.hasPartnerQr;
      }
      surface.target.dataset.hasPartnerQr = "true";
      markedTargetRef.current = surface.target;

      const next: BridgeState = {
        key: `${surface.mode}:${matchedCampaign.id ?? "campaign"}:${matchedItem.id ?? matchedItem.assetId ?? "item"}:${qrUrl}`,
        target: surface.target,
        mode: surface.mode,
        qrUrl,
        campaignName: matchedCampaign.name || "Partenaire",
        destinationUrl: matchedItem.qrDestinationUrl ?? null,
        ctaLabel: matchedItem.ctaLabel ?? null,
      };

      setBridge((previous) => previous?.key === next.key && previous.target === next.target ? previous : next);
    };

    detect();
    const observer = new MutationObserver(detect);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src", "class", "style"],
    });
    const timer = window.setInterval(detect, 500);

    return () => {
      observer.disconnect();
      window.clearInterval(timer);
      clearMarkedTarget();
    };
  }, [stationId]);

  if (!bridge) return null;

  const copy = lang === "de"
    ? {
        scan: "QR-Code scannen",
        prefix: "Entdecken Sie",
        suffix: "auf Ihrem Smartphone",
        destination: "Ziel",
      }
    : lang === "en"
      ? {
          scan: "Scan the QR code",
          prefix: "Discover",
          suffix: "on your phone",
          destination: "Destination",
        }
      : {
          scan: "Scannez le QR code",
          prefix: "Découvrez",
          suffix: "sur votre téléphone",
          destination: "Destination",
        };

  return createPortal(
    <KioskAdvertisingPartnerPanel
      mode={bridge.mode}
      qrUrl={bridge.qrUrl}
      campaignName={bridge.campaignName}
      destinationUrl={bridge.destinationUrl}
      ctaLabel={bridge.ctaLabel}
      scanLabel={copy.scan}
      detailPrefix={copy.prefix}
      detailSuffix={copy.suffix}
      destinationLabel={copy.destination}
    />,
    bridge.target,
  );
}

export function KioskAdvertisingPartnerBridge() {
  return (
    <AdvertisingPartnerBoundary>
      <KioskAdvertisingPartnerBridgeRuntime />
    </AdvertisingPartnerBoundary>
  );
}
