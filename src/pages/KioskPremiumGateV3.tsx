import { useLayoutEffect } from "react";
import KioskPremiumGateV2 from "./KioskPremiumGateV2";
import { KioskV3AuthGuard } from "@/components/kiosk/KioskV3AuthGuard";
import { KioskV3OwnedHome } from "@/components/kiosk/KioskV3OwnedHome";
import { KioskAdvertisingLayer } from "@/components/kiosk/KioskAdvertisingLayer";
import "./kiosk-production-edge-states.css";
import "./kiosk-v3-owned-home.css";
import "./kiosk-v4-canonical-1280x720.css";
import "./kiosk-home-atmosphere-canonical.css";
import "./kiosk-p0-home-clean.css";

/**
 * P0 recovery entry: one visible owner at a time.
 *
 * - KioskPremiumGateV2 owns boot, auth-aware state and the transaction machine.
 * - KioskV3OwnedHome is the only home presentation and disappears when V2 leaves home.
 * - KioskAdvertisingLayer is an isolated, fail-safe paid-media surface only. It may
 *   reserve the Home ad rail or show the idle screensaver, but never owns rental,
 *   payment, return, inventory or hardware state.
 * - KioskV3AuthGuard remains the only security blocking overlay and is mounted last.
 *
 * All legacy presentation directors, cinematic/touch/recovery overlays, duplicate
 * journey chrome and WebView-failsafe styling are deliberately excluded from this
 * entry during recovery. They were independent DOM observers/painters and could
 * race the canonical surface during cold boot or service-worker activation.
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
      <KioskAdvertisingLayer />
      <KioskV3AuthGuard />
    </div>
  );
}
