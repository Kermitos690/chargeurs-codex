import { useEffect } from "react";
import KioskPremiumGateV2 from "./KioskPremiumGateV2";
import { KioskV3Atmosphere } from "@/components/kiosk/KioskV3Atmosphere";
import { KioskV3CinematicDirector } from "@/components/kiosk/KioskV3CinematicDirector";
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
import "./kiosk-production-cinematic-director.css";
import "./kiosk-production-recovery.css";
import "./kiosk-production-physical-director-v2.css";

/**
 * Production kiosk entry.
 * Business orchestration remains in the proven V2 gate/Kiosk state machine;
 * the route owns the physical 16:9 presentation system.
 *
 * The cinematic director is decorative and pointer-free. Recovery and physical
 * director layers remain presentation-only. They never own payment, rental,
 * return, inventory or hardware state.
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
      <KioskAdvertisingLayer />
    </div>
  );
}
