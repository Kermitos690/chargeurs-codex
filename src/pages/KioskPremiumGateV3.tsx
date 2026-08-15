import { useLayoutEffect } from "react";
import KioskPremiumGateV2 from "./KioskPremiumGateV2";
import { KioskV3AuthGuard } from "@/components/kiosk/KioskV3AuthGuard";
import { KioskV3OwnedHome } from "@/components/kiosk/KioskV3OwnedHome";
import "./kiosk-production-edge-states.css";
import "./kiosk-v3-owned-home.css";
import "./kiosk-v4-canonical-1280x720.css";
import "./kiosk-home-atmosphere-canonical.css";
import "./kiosk-p0-home-balanced.css";

/**
 * P0 recovery entry: one visible owner at a time.
 *
 * - KioskPremiumGateV2 owns boot, auth-aware state and the transaction machine.
 * - KioskV3OwnedHome is the only home presentation and disappears when V2 leaves home.
 * - KioskV3AuthGuard remains the only security blocking overlay and stays last.
 *
 * Advertising and all other nonessential presentation layers stay excluded during
 * physical recovery so the customer runtime cannot regain a second visual owner.
 */
export default function KioskPremiumGateV3() {
  useLayoutEffect(() => {
    document.documentElement.dataset.kioskVersion = "premium-recovery-single-owner-1280x720";
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
    <div className="kv3-runtime" data-presentation-owner="premium-recovery-single-owner">
      <div className="kv3-product-layer">
        <KioskPremiumGateV2 />
      </div>
      <KioskV3OwnedHome />
      <KioskV3AuthGuard />
    </div>
  );
}
