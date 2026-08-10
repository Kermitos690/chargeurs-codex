import { useEffect } from "react";
import KioskPremiumGateV2 from "./KioskPremiumGateV2";
import { KioskV3Atmosphere } from "@/components/kiosk/KioskV3Atmosphere";
import { KioskV3HomeChrome } from "@/components/kiosk/KioskV3HomeChrome";
import { KioskV3JourneyChrome } from "@/components/kiosk/KioskV3JourneyChrome";
import "./kiosk-production-cinematic.css";
import "./kiosk-production-objects.css";
import "./kiosk-production-scenes.css";
import "./kiosk-production-return.css";

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
      document.documentElement.classList.remove("kiosk-v3");
    };
  }, []);

  return (
    <div className="kv3-runtime">
      <KioskV3Atmosphere />
      <div className="kv3-product-layer">
        <KioskPremiumGateV2 />
      </div>
      <KioskV3HomeChrome />
      <KioskV3JourneyChrome />
    </div>
  );
}
