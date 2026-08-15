import { useLayoutEffect } from "react";
import KioskPremiumGateV2 from "./KioskPremiumGateV2";
import { KioskV3AuthGuard } from "@/components/kiosk/KioskV3AuthGuard";
import { KioskAdvertisingSynchronizedLayer } from "@/components/kiosk/KioskAdvertisingSynchronizedLayer";
import "./kiosk-production-edge-states.css";
import "./kiosk-premium-home-canonical.css";
import "./kiosk-pricing-explainer.css";
import "./kiosk-home-reference-lock.css";
import "./kiosk-home-physical-viewport-lock.css";

/** Single-owner Premium kiosk runtime. */
export default function KioskPremiumGateV3() {
  useLayoutEffect(() => {
    document.documentElement.dataset.kioskVersion = "premium-field-reference-physical-lock-2026-1280x720";
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
    <div className="kv3-runtime" data-presentation-owner="premium-field-reference-physical-lock-2026">
      <div className="kv3-product-layer"><KioskPremiumGateV2 /></div>
      <KioskAdvertisingSynchronizedLayer />
      <KioskV3AuthGuard />
    </div>
  );
}
