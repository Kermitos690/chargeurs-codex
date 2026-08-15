import { useLayoutEffect } from "react";
import KioskPremiumGateV2 from "./KioskPremiumGateV2";
import { KioskV3AuthGuard } from "@/components/kiosk/KioskV3AuthGuard";
import { KioskAdvertisingSynchronizedLayer } from "@/components/kiosk/KioskAdvertisingSynchronizedLayer";
import "./kiosk-production-edge-states.css";
import "./kiosk-premium-home-canonical.css";

/**
 * P0 recovery entry: exactly one product presentation owner.
 *
 * - KioskPremiumGateV2 owns Home, customer journey and the transaction machine.
 * - There is no parallel Home overlay or DOM proxy clicking a hidden Home below it.
 * - kiosk-premium-home-canonical.css styles that same Home DOM; it creates no second owner.
 * - KioskAdvertisingSynchronizedLayer remains isolated and may disappear without
 *   affecting rental, payment, return, inventory or hardware state.
 * - KioskV3AuthGuard remains the only security blocking overlay and stays last.
 */
export default function KioskPremiumGateV3() {
  useLayoutEffect(() => {
    document.documentElement.dataset.kioskVersion = "premium-single-owner-canonical-2026-1280x720";
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
    <div className="kv3-runtime" data-presentation-owner="premium-single-owner-canonical-2026">
      <div className="kv3-product-layer">
        <KioskPremiumGateV2 />
      </div>
      <KioskAdvertisingSynchronizedLayer />
      <KioskV3AuthGuard />
    </div>
  );
}
