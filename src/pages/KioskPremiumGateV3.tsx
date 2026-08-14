import { useLayoutEffect } from "react";
import KioskPremiumGateV2 from "./KioskPremiumGateV2";
import { KioskV3Atmosphere } from "@/components/kiosk/KioskV3Atmosphere";
import { KioskV3AuthGuard } from "@/components/kiosk/KioskV3AuthGuard";
import { KioskV3OwnedHome } from "@/components/kiosk/KioskV3OwnedHome";
import { KioskV3JourneyChrome } from "@/components/kiosk/KioskV3JourneyChrome";
import "./kiosk-production-cinematic.css";
import "./kiosk-production-objects.css";
import "./kiosk-production-scenes.css";
import "./kiosk-production-return.css";
import "./kiosk-production-help.css";
import "./kiosk-production-hotfix.css";
import "./kiosk-production-physical-qa.css";
import "./kiosk-production-cinematic-director.css";
import "./kiosk-production-recovery.css";
import "./kiosk-production-physical-director-v2.css";
import "./kiosk-production-screen-director-v3.css";
import "./kiosk-production-hardware-2p5d.css";
import "./kiosk-production-i18n-guard.css";
import "./kiosk-production-pricing-recovery.css";
import "./kiosk-production-touch-feedback.css";
import "./kiosk-production-edge-states.css";
import "./kiosk-production-contextual-help.css";
import "./kiosk-production-webview-landscape-failsafe.css";
import "./kiosk-v3-owned-home.css";
import "./kiosk-v4-canonical-1280x720.css";
import "./kiosk-home-atmosphere-canonical.css";

/**
 * Canonical production kiosk entry.
 *
 * There is exactly one presentation owner for each surface:
 * - V2 owns the transactional state machine and journey screens.
 * - OwnedHome owns the visible home while V2's home remains only the callback source.
 * - JourneyChrome owns the single progress rail during a transaction.
 * - Atmosphere is background-only and AuthGuard is security-only.
 *
 * Previous presentation observers/recovery/touch/advertising directors were
 * intentionally removed from this root. They all inspected the same DOM and
 * could paint concurrent controls above V2, which produced duplicated buttons,
 * overlapping recovery cards and the appearance of two kiosk versions.
 */
export default function KioskPremiumGateV3() {
  useLayoutEffect(() => {
    document.documentElement.dataset.kioskVersion = "premium-single-owner-1280x720";
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
    <div className="kv3-runtime" data-presentation-owner="premium-single-owner">
      <KioskV3Atmosphere />
      <div className="kv3-product-layer">
        <KioskPremiumGateV2 />
      </div>
      <KioskV3OwnedHome />
      <KioskV3JourneyChrome />
      <KioskV3AuthGuard />
    </div>
  );
}
