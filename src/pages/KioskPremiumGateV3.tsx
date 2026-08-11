import { useEffect } from "react";
import KioskPremiumGateV2 from "./KioskPremiumGateV2";
import { KioskV3Atmosphere } from "@/components/kiosk/KioskV3Atmosphere";
import { KioskV3HomeChrome } from "@/components/kiosk/KioskV3HomeChrome";
import { KioskV3JourneyChrome } from "@/components/kiosk/KioskV3JourneyChrome";
import { KioskV3TimeoutOwnershipGuard } from "@/components/kiosk/KioskV3TimeoutOwnershipGuard";
import { KioskAdvertisingLayer } from "@/components/kiosk/KioskAdvertisingLayer";
import "./kiosk-production-cinematic.css";
import "./kiosk-production-objects.css";
import "./kiosk-production-scenes.css";
import "./kiosk-production-return.css";
import "./kiosk-production-help.css";
import "./kiosk-production-hotfix.css";
import "./kiosk-production-physical-qa.css";
import "./kiosk-production-physical-qa-pass2.css";
import "./kiosk-production-home-decision-v3.css";
import "./kiosk-production-premium-journey-v4.css";

/**
 * Production kiosk entry.
 * Business orchestration remains in the proven V2 gate/Kiosk state machine;
 * the route owns the physical 16:9 presentation system from the validated PDF.
 */
export default function KioskPremiumGateV3() {
  useEffect(() => {
    document.documentElement.dataset.kioskVersion = "v3-production";
    document.documentElement.classList.add("kiosk-v3");
    return () => {
      delete document.documentElement.dataset.kioskVersion;
      delete document.documentElement.dataset.kioskScene;
      delete document.documentElement.dataset.kioskAdsSplit;
      document.documentElement.style.removeProperty("--kiosk-ad-split-ratio");
      document.documentElement.classList.remove("kiosk-v3");
    };
  }, []);

  return (
    <div className="kv3-runtime">
      <KioskV3Atmosphere />
      <div className="kv3-product-layer">
        <KioskPremiumGateV2 />
      </div>
      <KioskV3TimeoutOwnershipGuard />
      <KioskV3HomeChrome />
      <KioskV3JourneyChrome />
      <KioskAdvertisingLayer />
    </div>
  );
}
