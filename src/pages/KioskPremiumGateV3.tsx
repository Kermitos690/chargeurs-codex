import { useLayoutEffect } from "react";
import KioskPremiumGateV2 from "./KioskPremiumGateV2";
import { KioskV3AuthGuard } from "@/components/kiosk/KioskV3AuthGuard";
import { KioskAdvertisingSynchronizedLayer } from "@/components/kiosk/KioskAdvertisingSynchronizedLayer";
import "./kiosk-production-edge-states.css";
import "./kiosk-premium-home-canonical.css";
import "./kiosk-pricing-explainer.css";

/**
 * Single-owner Premium kiosk runtime.
 *
 * KioskPremiumGateV2 owns Home, pricing explanations, customer pairing and
 * transaction entry. Advertising stays isolated from the rental machine and the
 * auth guard remains the only security blocking overlay.
 */
export default function KioskPremiumGateV3() {
  useLayoutEffect(() => {
    document.documentElement.dataset.kioskVersion = "premium-single-owner-pricing-explainer-2026-1280x720";
    document.documentElement.classList.add("kiosk-v3");
    return () => {
      delete document.documentElement.dataset.kioskVersion;
      delete document.documentElement.dataset.kioskScene;
      delete document.documentElement.dataset.kioskLastScene;
      delete document.documentElement.dataset.kioskReturnStage;
      delete document.documentElement.dataset.kioskAdsSplit;
      delete document.documentElement.dataset.kioskHelpContext;
      delete document.documentElement.dataset.kioskAuth;
      document.documentElement.style.removeProperty("--kiosk-ad-split-ratio");
      document.documentElement.classList.remove("kiosk-v3");
    };
  }, []);

  return (
    <div className="kv3-runtime" data-presentation-owner="premium-single-owner-pricing-explainer-2026">
      <div className="kv3-product-layer">
        <KioskPremiumGateV2 />
      </div>
      <KioskAdvertisingSynchronizedLayer />
      <KioskV3AuthGuard />
    </div>
  );
}
