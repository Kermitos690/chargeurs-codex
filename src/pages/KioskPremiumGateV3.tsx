import { useLayoutEffect } from "react";
import KioskPremiumGateV2 from "./KioskPremiumGateV2";
import { KioskV3AuthGuard } from "@/components/kiosk/KioskV3AuthGuard";
import { KioskPaymentTimeoutGuard } from "@/components/kiosk/KioskPaymentTimeoutGuard";
import "./kiosk-production-edge-states.css";
import "./kiosk-pricing-explainer.css";
import "./kiosk-home-reference-lock.css";

/**
 * Single-owner Premium kiosk runtime.
 * Home visual authority: kiosk-home-reference-lock.css only.
 * Business journey / pricing / Terminal-QR behavior stays owned by KioskPremiumGateV2 + Kiosk.
 *
 * P0 field lock: Advertising is intentionally not mounted while the exact Home
 * reference is being physically qualified. This prevents a cached/configured
 * split campaign from reserving or covering the right side of the approved
 * 1280×720 Home. Advertising remains isolated and can be re-enabled after the
 * Home is physically accepted; no rental/payment/hardware behavior is changed.
 */
export default function KioskPremiumGateV3() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.kioskVersion = "neon-reference-home-single-owner-2026-1280x720";
    root.classList.add("kiosk-v3");

    const syncHomeScene = () => {
      const homeVisible = Boolean(document.querySelector(".kv3-product-layer > .ck2-home"));
      if (homeVisible) {
        root.dataset.kioskScene = "home";
      } else if (root.dataset.kioskScene === "home") {
        delete root.dataset.kioskScene;
      }
    };

    syncHomeScene();
    const sceneObserver = new MutationObserver(syncHomeScene);
    sceneObserver.observe(document.body, { childList: true, subtree: true });

    return () => {
      sceneObserver.disconnect();
      delete root.dataset.kioskVersion;
      delete root.dataset.kioskScene;
      delete root.dataset.kioskLastScene;
      delete root.dataset.kioskReturnStage;
      delete root.dataset.kioskAdsSplit;
      delete root.dataset.kioskHelpContext;
      delete root.dataset.kioskAuth;
      root.style.removeProperty("--kiosk-ad-split-ratio");
      root.classList.remove("kiosk-v3");
    };
  }, []);

  return (
    <div className="kv3-runtime" data-presentation-owner="neon-reference-home-single-owner-2026">
      <div className="kv3-product-layer"><KioskPremiumGateV2 /></div>
      <KioskPaymentTimeoutGuard />
      <KioskV3AuthGuard />
    </div>
  );
}
