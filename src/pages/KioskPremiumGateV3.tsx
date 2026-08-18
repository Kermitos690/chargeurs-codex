import { useLayoutEffect } from "react";
import KioskPremiumGateV2 from "./KioskPremiumGateV2";
import { KioskV3AuthGuard } from "@/components/kiosk/KioskV3AuthGuard";
import { KioskPaymentTimeoutGuard } from "@/components/kiosk/KioskPaymentTimeoutGuard";
import { KioskSystemFooter } from "@/components/kiosk/KioskSystemFooter";
import "./kiosk-production-edge-states.css";
import "./kiosk-pricing-explainer.css";
import "./kiosk-home-reference-lock.css";
import "./kiosk-p0-core-scenes.css";
import "./kiosk-p0-physical-proof.css";
import "./kiosk-p0-confirmation-polish.css";
import "./kiosk-p0-transaction-readability.css";
import "./kiosk-1280-geometry-contract.css";

/**
 * Single-owner Premium kiosk runtime.
 *
 * Scene files own visual presentation. Transaction readability is applied before
 * the final 1280×720 geometry contract, which owns only physical framing so
 * header/content/CTA/footer dimensions cannot drift per deployment. Business
 * journey, pricing, payment and hardware remain untouched.
 */
export default function KioskPremiumGateV3() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.kioskVersion = "p0-deterministic-transaction-2026-1280x720";
    root.classList.add("kiosk-v3");

    const syncScene = () => {
      let scene = "";
      if (document.querySelector(".kv3-product-layer > .ck2-home")) scene = "home";
      else if (document.querySelector(".kv3-product-layer > .ck2-connected")) scene = "connected";
      else if (document.querySelector(".kv3-product-layer > .ck2-member")) scene = "member";
      else if (document.querySelector(".kv3-product-layer .kiosk-qr-stage")) scene = "payment";
      else if (document.querySelector(".kv3-product-layer .kiosk-payment-rail-stage")) scene = "payment-choice";
      else if (document.querySelector(".kv3-product-layer .kiosk-pricing-stage")) scene = "pricing";
      else if (document.querySelector(".kv3-product-layer .kiosk-idle-stage")) scene = "selection";
      else if (document.querySelector(".kv3-product-layer .kiosk-ready-stage")) scene = "success";
      else if (document.querySelector(".kv3-product-layer .kiosk-release-stage")) scene = "release";

      if (scene) root.dataset.kioskScene = scene;
      else delete root.dataset.kioskScene;
    };

    syncScene();
    const sceneObserver = new MutationObserver(syncScene);
    sceneObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });

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
    <div className="kv3-runtime" data-presentation-owner="p0-deterministic-transaction-2026">
      <div className="kv3-product-layer"><KioskPremiumGateV2 /></div>
      <KioskSystemFooter />
      <KioskPaymentTimeoutGuard />
      <KioskV3AuthGuard />
    </div>
  );
}
