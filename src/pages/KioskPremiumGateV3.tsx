import { useEffect } from "react";
import KioskPremiumGateV2 from "./KioskPremiumGateV2";
import { KioskV3Atmosphere } from "@/components/kiosk/KioskV3Atmosphere";
import { KioskV3HomeChrome } from "@/components/kiosk/KioskV3HomeChrome";
import "./kiosk-premium-v3.css";
import "./kiosk-premium-v3-final.css";

/**
 * Kiosk V3 intentionally reuses the proven V2 orchestration/pairing/rental
 * logic while replacing the presentation layer. This keeps payment and
 * hardware behavior stable and makes the V3 rollout reversible.
 */
export default function KioskPremiumGateV3() {
  useEffect(() => {
    document.documentElement.dataset.kioskVersion = "v3";
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
