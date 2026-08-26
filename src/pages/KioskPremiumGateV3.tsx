import { useLayoutEffect } from "react";
import KioskPremiumGateV2 from "./KioskPremiumGateV2";
import { KioskV3AuthGuard } from "@/components/kiosk/KioskV3AuthGuard";
import { KioskPaymentTimeoutGuard } from "@/components/kiosk/KioskPaymentTimeoutGuard";
import { KioskSystemFooter } from "@/components/kiosk/KioskSystemFooter";
import { KioskAdvertisingSynchronizedLayer } from "@/components/kiosk/KioskAdvertisingSynchronizedLayer";
import "./kiosk-production-edge-states.css";
import "./kiosk-pricing-explainer.css";
import "./kiosk-home-reference-lock.css";
import "./kiosk-p0-core-scenes.css";
import "./kiosk-p0-physical-proof.css";
import "./kiosk-p0-confirmation-polish.css";
import "./kiosk-p0-transaction-readability.css";
import "./kiosk-1280-geometry-contract.css";
import "@/components/kiosk/kiosk-advertising-p0-safe.css";
import "./kiosk-p0-support-safe.css";
import "./kiosk-p0-safe-frame-1280.css";
import "./kiosk-p0-selection-fit.css";
import "./kiosk-global-legibility.css";
import "./kiosk-footer-home-pricing.css";
import "./kiosk-field-final.css";

const GOLDEN_FR_HOME_TITLE = "BESOIN DE BATTERIE ?";

/*
 * These titles are all server-derived protected post-payment states. They are
 * intentionally presented through the `waitpay` runtime so session polling
 * remains alive. Detection is presentation-only: it never changes payment,
 * rental, stock or hardware state.
 */
function isProtectedSupportTitle(title: string) {
  const normalized = title.trim().toLowerCase();
  if (!normalized) return false;
  return /support|vérification|verification|überprüfung|intervention|eingriff|revue manuelle|manual review|manuelle prüfung|paiement confirmé\s*[—-]|payment confirmed\s*[—-]|zahlung bestätigt\s*[—-]/i.test(normalized);
}

/*
 * Financially final exits must never strand the customer on a retry screen.
 * These labels are rendered only after the scoped rental/session projection has
 * reached a final cancelled/failed/expired/refunded state. Technical failures
 * and support/reconciliation states are deliberately excluded.
 */
function isFinalPaymentExitTitle(title: string) {
  const normalized = title.trim().toLowerCase();
  if (!normalized) return false;
  return /^(annulé|paiement non abouti|qr code expiré|remboursé|cancelled|canceled|payment failed|payment declined|qr code expired|refunded|abgebrochen|zahlung fehlgeschlagen|zahlung abgelehnt|qr-code abgelaufen|erstattet)$/i.test(normalized);
}

function isCancellationProgressTitle(title: string) {
  const normalized = title.trim().toLowerCase();
  return /^(annulation sécurisée en cours|secure cancellation in progress|sicherer abbruch läuft)$/i.test(normalized);
}

function secureSupportLabel(lang: string) {
  const normalized = lang.toLowerCase();
  if (normalized.startsWith("de")) return "✓ Sichere Zahlung über Stripe";
  if (normalized.startsWith("en")) return "✓ Secure payment by Stripe";
  return "✓ Paiement sécurisé par Stripe";
}

/**
 * Single-owner Premium kiosk runtime.
 *
 * Rental/product presentation remains the sole transaction owner. Advertising
 * is mounted as an isolated fail-safe sibling and may only use the explicitly
 * safe surfaces enforced by KioskAdvertisingLayer.
 */
export default function KioskPremiumGateV3() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.kioskVersion = "p0-deterministic-transaction-v2-ads-restored-2026-1280x720";
    root.dataset.kioskHomeGolden = "true";
    root.classList.add("kiosk-v3");

    let cancellationProgressObserved = false;
    let homeReturnTimer: number | null = null;

    const requestTrueHome = () => {
      if (homeReturnTimer !== null) return;
      homeReturnTimer = window.setTimeout(() => {
        homeReturnTimer = null;
        // V2 deliberately blocks ordinary Home requests while a release/final
        // stage is mounted. A financially-final cancellation therefore cannot
        // rely on that guarded callback: reload the same kiosk route instead.
        // The boot resume-state check remains authoritative and will only land
        // on Home when no active rental/payment still requires kiosk action.
        const url = new URL(window.location.href);
        url.searchParams.set("kiosk_return_home", String(Date.now()));
        window.location.replace(`${url.pathname}${url.search}${url.hash}`);
      }, 0);
    };

    const syncScene = () => {
      let scene = "";
      const productLayer = document.querySelector<HTMLElement>(".kv3-product-layer");
      const home = document.querySelector<HTMLElement>(".kv3-product-layer > .ck2-home");
      const releaseStage = document.querySelector<HTMLElement>(".kv3-product-layer .kiosk-release-stage");
      const releaseTitle = releaseStage?.querySelector<HTMLElement>("h2")?.textContent?.trim() ?? "";
      const protectedSupport = Boolean(releaseStage && isProtectedSupportTitle(releaseTitle));
      const paymentRailStage = document.querySelector<HTMLElement>(".kv3-product-layer .kiosk-payment-rail-stage");
      const paymentRailTitle = paymentRailStage?.querySelector<HTMLElement>("h2")?.textContent?.trim() ?? "";

      if (isCancellationProgressTitle(paymentRailTitle)) cancellationProgressObserved = true;

      const finalPaymentExit = productLayer
        ? Array.from(productLayer.querySelectorAll<HTMLElement>("h2"))
            .map((heading) => heading.textContent?.trim() ?? "")
            .find(isFinalPaymentExitTitle)
        : undefined;

      if (finalPaymentExit) {
        root.dataset.kioskLastScene = "final-payment-exit";
        requestTrueHome();
        return;
      }

      if (home) scene = "home";
      else if (document.querySelector(".kv3-product-layer > .ck2-connected")) scene = "connected";
      else if (document.querySelector(".kv3-product-layer > .ck2-member")) scene = "member";
      else if (document.querySelector(".kv3-product-layer .kiosk-qr-stage")) scene = "payment";
      else if (paymentRailStage) scene = "payment-choice";
      else if (document.querySelector(".kv3-product-layer .kiosk-pricing-stage")) scene = "pricing";
      else if (document.querySelector(".kv3-product-layer .kiosk-idle-stage")) scene = "selection";
      else if (document.querySelector(".kv3-product-layer .h-20.w-20.animate-spin.text-primary")) scene = "starting";
      else if (document.querySelector(".kv3-product-layer .kiosk-ready-stage")) scene = "success";
      else if (releaseStage) scene = protectedSupport ? "support" : "release";

      // Current Kiosk.tsx already removes its cancelled scene and locally resets
      // after canonical terminal cancellation. In the premium shell that local
      // reset lands on battery selection, not the true public Home. A transition
      // from a confirmed cancellation flow back to selection therefore promotes
      // the outer V2 shell to its real Home. If cancellation fails, the payment
      // stage remains mounted and this branch never fires.
      if (scene === "selection" && cancellationProgressObserved) {
        cancellationProgressObserved = false;
        root.dataset.kioskLastScene = "cancelled-to-selection";
        requestTrueHome();
        return;
      }
      if (scene === "home") cancellationProgressObserved = false;

      if (scene) root.dataset.kioskScene = scene;
      else delete root.dataset.kioskScene;

      if (releaseStage) {
        const card = releaseStage.children.item(1) as HTMLElement | null;
        if (card && protectedSupport) {
          card.dataset.supportSecureLabel = secureSupportLabel(root.lang || "fr");
          card.setAttribute("aria-live", "polite");
          card.setAttribute("aria-busy", "true");
        } else if (card) {
          delete card.dataset.supportSecureLabel;
          card.removeAttribute("aria-live");
          card.removeAttribute("aria-busy");
        }
      }

      if (home && (root.lang || "fr").toLowerCase().startsWith("fr")) {
        const title = home.querySelector<HTMLElement>(".ck2-home-title");
        if (title && title.textContent !== GOLDEN_FR_HOME_TITLE) {
          title.textContent = GOLDEN_FR_HOME_TITLE;
        }
        const choices = home.querySelector<HTMLElement>(".ck2-reference-choice-grid");
        if (choices && choices.getAttribute("aria-label") !== GOLDEN_FR_HOME_TITLE) {
          choices.setAttribute("aria-label", GOLDEN_FR_HOME_TITLE);
        }
      }
    };

    syncScene();
    const sceneObserver = new MutationObserver(syncScene);
    sceneObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
      attributeFilter: ["class"],
    });
    const langObserver = new MutationObserver(syncScene);
    langObserver.observe(root, { attributes: true, attributeFilter: ["lang"] });

    return () => {
      sceneObserver.disconnect();
      langObserver.disconnect();
      if (homeReturnTimer !== null) window.clearTimeout(homeReturnTimer);
      delete root.dataset.kioskVersion;
      delete root.dataset.kioskHomeGolden;
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
    <div className="kv3-runtime" data-presentation-owner="p0-deterministic-transaction-v2-ads-restored-2026">
      <div className="kv3-product-layer"><KioskPremiumGateV2 /></div>
      <KioskAdvertisingSynchronizedLayer />
      <KioskSystemFooter />
      <KioskPaymentTimeoutGuard />
      <KioskV3AuthGuard />
    </div>
  );
}
