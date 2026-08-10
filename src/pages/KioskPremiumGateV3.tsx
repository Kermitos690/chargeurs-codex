import { useEffect } from "react";
import KioskPremiumGateV2 from "./KioskPremiumGateV2";
import { KioskV3Atmosphere } from "@/components/kiosk/KioskV3Atmosphere";
import { KioskV3HomeChrome } from "@/components/kiosk/KioskV3HomeChrome";
import "./kiosk-production-cinematic.css";

/**
 * Production kiosk entry.
 * Business orchestration remains in the proven V2 gate/Kiosk state machine;
 * this route owns one consolidated physical 16:9 presentation layer.
 */
export default function KioskPremiumGateV3() {
  useEffect(() => {
    document.documentElement.dataset.kioskVersion = "v3-production";
    document.documentElement.classList.add("kiosk-v3");
    return () => {
      delete document.documentElement.dataset.kioskVersion;
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
    </div>
  );
}
