import { ExternalLink, Smartphone } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import "./kiosk-advertising-partner-panel.css";

type DisplayMode = "split" | "screensaver";

type Props = {
  mode: DisplayMode;
  qrUrl: string;
  campaignName: string;
  destinationUrl?: string | null;
  ctaLabel?: string | null;
  scanLabel: string;
  detailPrefix: string;
  detailSuffix: string;
  destinationLabel: string;
};

function extractPartnerName(campaignName: string) {
  const parts = campaignName
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  const candidate = (parts.length ? parts[parts.length - 1] : "") || campaignName.trim() || "Partenaire";
  const clean = candidate
    .replace(/chargeurs\.ch/gi, "")
    .replace(/[×x\-–—]+$/g, "")
    .trim();
  return clean || "Partenaire";
}

function destinationHost(value?: string | null) {
  if (!value) return "";
  try {
    return new URL(value).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

export function KioskAdvertisingPartnerPanel({
  mode,
  qrUrl,
  campaignName,
  destinationUrl,
  ctaLabel,
  scanLabel,
  detailPrefix,
  detailSuffix,
  destinationLabel,
}: Props) {
  const partner = extractPartnerName(campaignName);
  const host = destinationHost(destinationUrl);
  const action = ctaLabel?.trim() || scanLabel;

  return (
    <section
      className={`kiosk-ad-partner-panel kiosk-ad-partner-panel--${mode}`}
      aria-label={`${partner} × Chargeurs.ch — ${action}`}
    >
      <div className="kiosk-ad-partner-panel__brand">
        <span>{partner}</span>
        <b>×</b>
        <span>Chargeurs.ch</span>
      </div>

      <div className="kiosk-ad-partner-panel__body">
        <div className="kiosk-ad-partner-panel__qr" aria-hidden="true">
          <QRCodeSVG value={qrUrl} level="M" marginSize={1} />
        </div>

        <div className="kiosk-ad-partner-panel__copy">
          <div className="kiosk-ad-partner-panel__action">
            <Smartphone />
            <strong>{action}</strong>
          </div>
          <p>{detailPrefix} <b>{partner}</b> {detailSuffix}</p>
          {host && (
            <small>
              <ExternalLink />
              <span>{destinationLabel} · {host}</span>
            </small>
          )}
        </div>
      </div>
    </section>
  );
}
