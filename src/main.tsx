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
import { initAccountPwa, initKioskPwa } from "./pwa/registerSW";
import { prepareNativeKioskBootstrap } from "./pwa/nativeKioskBootstrap";

// The service worker and runtime recovery guards belong to the kiosk surface
// only. Public, account and administration pages keep their normal behavior.
const hashPath = window.location.hash.replace(/^#/, "");
const isKioskSurface =
  window.location.pathname === "/kiosk" ||
  window.location.pathname.startsWith("/kiosk/") ||
  hashPath === "/kiosk" ||
  hashPath.startsWith("/kiosk/");
const isStaticHashPreview = import.meta.env.VITE_ROUTER_MODE === "hash";
const isAccountSurface = window.location.pathname === "/compte" || window.location.pathname.startsWith("/compte/");

function detectNativeKioskWrapper() {
  if ("ChargeursNative" in window) return true;
  if (/\bChargeursKiosk\//i.test(navigator.userAgent || "")) return true;
  try {
    return Boolean(window.localStorage.getItem("chargeurs_native_wrapper"));
  } catch {
    return false;
  }
}

// The Android wrapper owns lifecycle, offline recovery and updates. On the
// field WebView the Javascript bridge can become observable a little later than
// the document head, so bridge presence alone is not a reliable native marker.
// The wrapper also appends ChargeursKiosk/<version> to the UA before navigation
// and persists a non-secret wrapper-version marker after credential injection.
const isNativeKioskWrapper = detectNativeKioskWrapper();
if (isKioskSurface && isNativeKioskWrapper) {
  document.documentElement.dataset.kioskNativeRuntime = "true";
}

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

// Native kiosk builds start a 20-second watchdog and expect the web app to call
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
  // kiosks never register this SW; their shell is cleaned before React above.
  if (isKioskSurface && !isStaticHashPreview && !isNativeKioskWrapper) {
    initKioskPwa();
  } else if (isAccountSurface && !isStaticHashPreview && !isNativeKioskWrapper) {
    // Chargeurs+ is installable in a normal mobile browser. The native
    // Android kiosk never reaches this branch, so its update/cache contract
    // remains isolated from the customer account.
    initAccountPwa();
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
