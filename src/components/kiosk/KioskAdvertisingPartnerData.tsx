import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useParams } from "react-router-dom";
import { ExternalLink, Smartphone } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useI18n } from "@/i18n/i18n";
import "./kiosk-advertising-partner-data.css";

const CACHE_PREFIX = "chargeurs:ads:playlist:";

type PartnerItem = {
  id: string;
  assetId: string;
  title: string;
  url: string;
  qrDestinationUrl?: string | null;
  ctaLabel?: string | null;
};

type PartnerCampaign = {
  id: string;
  name: string;
  items?: PartnerItem[];
};

type CachedPlaylist = {
  campaigns?: PartnerCampaign[];
};

type PartnerPanelState = {
  signature: string;
  target: HTMLElement;
  mode: "split" | "screensaver";
  campaignId: string;
  campaignName: string;
  assetId: string;
  qrDestinationUrl: string;
  ctaLabel: string | null;
};

function visibleSurface(): { target: HTMLElement; mode: "split" | "screensaver" } | null {
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

function activeMediaIdentity(surface: HTMLElement): { url: string; title: string } {
  const media = surface.querySelector<HTMLImageElement | HTMLVideoElement>(".kiosk-ad-media");
  if (!media) return { url: "", title: "" };
  const url = media.currentSrc || media.getAttribute("src") || "";
  const title = media instanceof HTMLImageElement
    ? media.alt
    : media.getAttribute("aria-label") || "";
  return { url, title };
}

function loadCachedPlaylist(stationId: string): CachedPlaylist | null {
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${stationId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedPlaylist;
    return Array.isArray(parsed.campaigns) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeUrl(value: string): string {
  try {
    const url = new URL(value, window.location.origin);
    url.hash = "";
    return url.toString();
  } catch {
    return value;
  }
}

function hostname(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

function partnerName(campaignName: string): string {
  const parts = campaignName.split("/").map((part) => part.trim()).filter(Boolean);
  const candidate = parts.at(-1) || campaignName.trim() || "Partenaire";
  return candidate.replace(/chargeurs\.ch/ig, "").replace(/[×x-]+$/g, "").trim() || "Partenaire";
}

function coBrandLabel(campaignName: string): string {
  const partner = partnerName(campaignName).toLocaleUpperCase("fr-CH");
  return partner === "PARTENAIRE" ? "PARTENAIRE × CHARGEURS.CH" : `${partner} × CHARGEURS.CH`;
}

export function KioskAdvertisingPartnerData() {
  const { stationId = "" } = useParams();
  const { lang } = useI18n();
  const [panel, setPanel] = useState<PartnerPanelState | null>(null);

  useEffect(() => {
    if (!stationId) {
      setPanel(null);
      return;
    }

    const detect = () => {
      const surface = visibleSurface();
      const cached = loadCachedPlaylist(stationId);
      if (!surface || !cached) {
        setPanel(null);
        return;
      }

      const media = activeMediaIdentity(surface.target);
      const normalizedMediaUrl = normalizeUrl(media.url);
      let match: { campaign: PartnerCampaign; item: PartnerItem } | null = null;

      for (const campaign of cached.campaigns ?? []) {
        for (const item of campaign.items ?? []) {
          const urlMatches = media.url && normalizeUrl(item.url) === normalizedMediaUrl;
          const titleMatches = media.title && item.title === media.title;
          if (urlMatches || titleMatches) {
            match = { campaign, item };
            break;
          }
        }
        if (match) break;
      }

      const destination = match?.item.qrDestinationUrl?.trim() ?? "";
      if (!match || !/^https:\/\//i.test(destination)) {
        setPanel(null);
        return;
      }

      const next: PartnerPanelState = {
        signature: `${surface.mode}:${match.campaign.id}:${match.item.id}:${destination}:${match.item.ctaLabel ?? ""}`,
        target: surface.target,
        mode: surface.mode,
        campaignId: match.campaign.id,
        campaignName: match.campaign.name,
        assetId: match.item.assetId,
        qrDestinationUrl: destination,
        ctaLabel: match.item.ctaLabel?.trim() || null,
      };

      setPanel((previous) => previous?.signature === next.signature && previous.target === next.target ? previous : next);
    };

    detect();
    const observer = new MutationObserver(detect);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "class", "style"] });
    const timer = window.setInterval(detect, 500);
    return () => {
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, [stationId]);

  if (!panel) return null;

  const copy = lang === "de"
    ? {
        action: "QR-Code scannen",
        detail: "Partnerinhalt auf dem Smartphone öffnen",
        destination: "Ziel",
      }
    : lang === "en"
      ? {
          action: "Scan the QR code",
          detail: "Open the partner content on your phone",
          destination: "Destination",
        }
      : {
          action: "Scannez le QR code",
          detail: "Ouvrez le contenu partenaire sur votre téléphone",
          destination: "Destination",
        };

  const destinationHost = hostname(panel.qrDestinationUrl);
  const actionLabel = panel.ctaLabel || copy.action;
  const brand = coBrandLabel(panel.campaignName);

  return createPortal(
    <>
      <div className={`kiosk-ad-cobrand kiosk-ad-cobrand--${panel.mode}`}>{brand}</div>
      <div
        className={`kiosk-ad-partner-data kiosk-ad-partner-data--${panel.mode}`}
        data-campaign-id={panel.campaignId}
        data-asset-id={panel.assetId}
        data-qr-destination={panel.qrDestinationUrl}
        aria-label={`${brand} — ${actionLabel}`}
      >
        <div className="kiosk-ad-partner-data__qr" aria-hidden="true">
          <QRCodeSVG value={panel.qrDestinationUrl} level="M" marginSize={1} />
        </div>
        <div className="kiosk-ad-partner-data__copy">
          <div className="kiosk-ad-partner-data__action"><Smartphone /> <strong>{actionLabel}</strong></div>
          <span>{copy.detail}</span>
          {destinationHost && (
            <small><ExternalLink /> {copy.destination} · {destinationHost}</small>
          )}
        </div>
      </div>
    </>,
    panel.target,
  );
}
