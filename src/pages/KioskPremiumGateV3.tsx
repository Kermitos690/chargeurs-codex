import { useLayoutEffect } from "react";
import KioskPremiumGateV2 from "./KioskPremiumGateV2";
import { KioskV3AuthGuard } from "@/components/kiosk/KioskV3AuthGuard";
import { KioskAdvertisingSynchronizedLayer } from "@/components/kiosk/KioskAdvertisingSynchronizedLayer";
import { KioskPaymentTimeoutGuard } from "@/components/kiosk/KioskPaymentTimeoutGuard";
import "./kiosk-production-edge-states.css";
import "./kiosk-pricing-explainer.css";
import "./kiosk-home-reference-lock.css";
import "./kiosk-home-p0-final-lock.css";

const GOLDEN_FR_HOME_TITLE = "BESOIN DE BATTERIE ?";

/**
 * Single-owner Premium kiosk runtime.
 * Home visual authority: reference lock + final physical/split-safe presentation lock.
 * Business journey / pricing / Terminal-QR behavior stays owned by KioskPremiumGateV2 + Kiosk.
 */
export default function KioskPremiumGateV3() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.kioskVersion = "p0-golden-home-split-safe-2026-1280x720";
    root.classList.add("kiosk-v3");

    const syncHomePresentation = () => {
      const home = document.querySelector<HTMLElement>(".kv3-product-layer > .ck2-home");
      if (!home) {
        if (root.dataset.kioskScene === "home") delete root.dataset.kioskScene;
        delete root.dataset.kioskHomeGolden;
        return;
      }

      root.dataset.kioskScene = "home";
      root.dataset.kioskHomeGolden = "true";

      // Presentation-only golden copy guard. React still owns the journey;
      // this only keeps the physical French Home label aligned with the P0 golden.
      if ((root.lang || "fr").toLowerCase().startsWith("fr")) {
        const title = home.querySelector<HTMLElement>(".ck2-home-title");
        if (title && title.textContent !== GOLDEN_FR_HOME_TITLE) {
          title.textContent = GOLDEN_FR_HOME_TITLE;
        }
        const choices = home.querySelector<HTMLElement>(".ck2-reference-choice-grid");
        if (choices?.getAttribute("aria-label") !== GOLDEN_FR_HOME_TITLE) {
          choices?.setAttribute("aria-label", GOLDEN_FR_HOME_TITLE);
        }
      }
    };

    syncHomePresentation();
    const sceneObserver = new MutationObserver(syncHomePresentation);
    sceneObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
    const langObserver = new MutationObserver(syncHomePresentation);
    langObserver.observe(root, { attributes: true, attributeFilter: ["lang"] });

    return () => {
      sceneObserver.disconnect();
      langObserver.disconnect();
      delete root.dataset.kioskVersion;
      delete root.dataset.kioskScene;
      delete root.dataset.kioskHomeGolden;
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
    <div className="kv3-runtime" data-presentation-owner="p0-golden-home-split-safe-2026">
      <div className="kv3-product-layer"><KioskPremiumGateV2 /></div>
      <KioskAdvertisingSynchronizedLayer />
      <KioskPaymentTimeoutGuard />
      <KioskV3AuthGuard />
    </div>
  );
}
