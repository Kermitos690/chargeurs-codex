import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "./kiosk-field.css";
import "./kiosk-customer-polish.css";
import "./kiosk-v2.css";
import "./kiosk-v2-gate.css";
import "./kiosk-v2-overlays.css";
import "./kiosk-final-overrides.css";
import "./kiosk-production-premium.css";
import { KioskBlankScreenGuard, KioskErrorBoundary } from "./components/kiosk/KioskRuntimeGuard";
import { initKioskPwa } from "./pwa/registerSW";
import { prepareNativeKioskBootstrap } from "./pwa/nativeKioskBootstrap";
import { initKioskHelpController } from "./kioskHelpController";

// The service worker and runtime recovery guards belong to the kiosk surface
// only. Public, account and administration pages keep their normal behavior.
const hashPath = window.location.hash.replace(/^#/, "");
const isKioskSurface =
  window.location.pathname === "/kiosk" ||
  window.location.pathname.startsWith("/kiosk/") ||
  hashPath === "/kiosk" ||
  hashPath.startsWith("/kiosk/");
const isStaticHashPreview = import.meta.env.VITE_ROUTER_MODE === "hash";
// The Android wrapper owns lifecycle, offline recovery and updates. A browser
// service worker inside that wrapper can retain an obsolete app shell after an
// APK update, so it is deliberately not used there.
const isNativeKioskWrapper = "ChargeursNative" in window;

type NativeKioskWindow = Window & {
  ChargeursNative?: { kioskUiReady?: () => void };
};

function showNativePreboot() {
  if (!isKioskSurface || !isNativeKioskWrapper) return;
  const root = document.getElementById("root");
  if (!root) return;
  root.innerHTML = `
    <div aria-label="Chargeurs.ch" style="position:fixed;inset:0;display:grid;place-items:center;background:#020713;color:#eef7ff;font:800 20px/1 system-ui,-apple-system,sans-serif;letter-spacing:-.02em">
      <div style="display:flex;align-items:center;gap:10px"><span style="display:grid;place-items:center;width:34px;height:34px;border-radius:12px;background:linear-gradient(135deg,#2c8cff,#59e9ff);color:#04101d">⚡</span><span>Chargeurs.ch</span></div>
    </div>`;
}

// APK 1.0.15 starts a 20-second native watchdog and expects the web app to call
// ChargeursNative.kioskUiReady() once React has actually painted kiosk UI.
function armNativeKioskUiReadyHandshake() {
  if (!isKioskSurface || !isNativeKioskWrapper) return;

  let notified = false;
  const notifyIfRendered = () => {
    if (notified) return true;

    const quarantine = document.querySelector(".kiosk-quarantine");
    const premium = document.querySelector(".kv3-owned-home, .premium-kiosk, .cinematic-home");
    const kioskRoot = document.querySelector(".kiosk-root");
    const main = document.querySelector("main");
    const renderedRoot = quarantine ?? premium ?? kioskRoot ?? main;
    const text = renderedRoot?.textContent?.replace(/\s+/g, "").trim() ?? "";
    if (!renderedRoot || text.length < 5) return false;

    try {
      (window as NativeKioskWindow).ChargeursNative?.kioskUiReady?.();
      notified = true;
      return true;
    } catch {
      return false;
    }
  };

  if (notifyIfRendered()) return;
  const observer = new MutationObserver(() => {
    if (notifyIfRendered()) observer.disconnect();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  const retry = window.setInterval(() => {
    if (notifyIfRendered()) {
      window.clearInterval(retry);
      observer.disconnect();
    }
  }, 500);
  window.setTimeout(() => {
    window.clearInterval(retry);
    observer.disconnect();
  }, 15_000);
}

async function startApplication() {
  // Never let a native Android kiosk paint a potentially stale React shell
  // while old browser SW/cache state is being retired. The neutral preboot is
  // intentionally independent from the rental/payment state machine.
  showNativePreboot();
  const bootstrap = await prepareNativeKioskBootstrap(isKioskSurface, isNativeKioskWrapper);
  if (bootstrap === "reloading") return;

  if (isKioskSurface) initKioskHelpController();

  createRoot(document.getElementById("root")!).render(
    isKioskSurface ? (
      <KioskErrorBoundary>
        <App />
        <KioskBlankScreenGuard />
      </KioskErrorBoundary>
    ) : (
      <App />
    ),
  );

  armNativeKioskUiReadyHandshake();

  // Browser/PWA kiosk routes keep controlled prompt updates because an
  // automatic reload during payment/rental would be unsafe. Native Android
  // kiosks never register this SW; their shell was cleaned before React above.
  if (isKioskSurface && !isStaticHashPreview && !isNativeKioskWrapper) {
    initKioskPwa();
  } else if (!isNativeKioskWrapper && "serviceWorker" in navigator) {
    navigator.serviceWorker
      .getRegistrations()
      .then((registrations) =>
        Promise.all(
          registrations
            .filter((registration) => registration.active?.scriptURL.endsWith("/sw.js"))
            .map((registration) => registration.unregister()),
        ),
      )
      .catch(() => {});
  }
}

void startApplication();
