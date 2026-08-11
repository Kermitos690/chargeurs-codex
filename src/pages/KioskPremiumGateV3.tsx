import { useEffect } from "react";
import KioskPremiumGateV2 from "./KioskPremiumGateV2";
import { KioskV3Atmosphere } from "@/components/kiosk/KioskV3Atmosphere";
import { KioskV3CinematicDirector } from "@/components/kiosk/KioskV3CinematicDirector";
import { KioskV3HomeChrome } from "@/components/kiosk/KioskV3HomeChrome";
import { KioskV3JourneyChrome } from "@/components/kiosk/KioskV3JourneyChrome";
import { KioskV3PricingRecovery } from "@/components/kiosk/KioskV3PricingRecovery";
import { KioskV3TimeoutOwnershipGuard } from "@/components/kiosk/KioskV3TimeoutOwnershipGuard";
import { KioskV3TouchFeedback } from "@/components/kiosk/KioskV3TouchFeedback";
import { KioskAdvertisingLayer } from "@/components/kiosk/KioskAdvertisingLayer";
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

/**
 * Production kiosk entry.
 * Business orchestration remains in the proven V2 gate/Kiosk state machine;
 * the route owns the physical 16:9 presentation system.
 *
 * Cinematic, recovery and hardware presentation layers are presentation-only.
 * They never infer or own payment, rental, return, inventory or hardware state.
 */
export default function KioskPremiumGateV3() {
  useEffect(() => {
    document.documentElement.dataset.kioskVersion = "v3-production";
    document.documentElement.classList.add("kiosk-v3");
    return () => {
      delete document.documentElement.dataset.kioskVersion;
      delete document.documentElement.dataset.kioskScene;
      delete document.documentElement.dataset.kioskLastScene;
      delete document.documentElement.dataset.kioskReturnStage;
      delete document.documentElement.dataset.kioskAdsSplit;
      document.documentElement.style.removeProperty("--kiosk-ad-split-ratio");
      document.documentElement.classList.remove("kiosk-v3");
    };
  }, []);

  return (
    <div className="kv3-runtime">
      <KioskV3Atmosphere />
      <KioskV3CinematicDirector />
      <div className="kv3-product-layer">
        <KioskPremiumGateV2 />
      </div>
      <KioskV3TimeoutOwnershipGuard />
      <KioskV3HomeChrome />
      <KioskV3JourneyChrome />
      <KioskV3PricingRecovery />
      <KioskV3TouchFeedback />
      <KioskAdvertisingLayer />
    </div>
  );
}
