import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "./kiosk-field.css";
import "./kiosk-customer-polish.css";
import "./kiosk-v2.css";
import "./kiosk-v2-gate.css";
import "./kiosk-v2-overlays.css";
import { KioskBlankScreenGuard, KioskErrorBoundary } from "./components/kiosk/KioskRuntimeGuard";
import { initKioskPwa } from "./pwa/registerSW";

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

// APK 1.0.15 starts a 20-second native watchdog and expects the web app to call
// ChargeursNative.kioskUiReady() once React has actually painted kiosk UI.
// Historically Kiosk.tsx did this itself, but the newer journey gate and the
// quarantine/safety overlays can be the first (and sometimes only) rendered
// screen. In that case Kiosk.tsx never mounts, so the native host used to
// replace a perfectly visible page with KIOSK_UI_NOT_RENDERED after 20 seconds.
//
// Keep the handshake at the application boundary instead of coupling it to one
// business screen. It carries no credential and does not mutate rental or
// hardware state; it only tells the existing APK that the web runtime rendered.
function armNativeKioskUiReadyHandshake() {
  if (!isKioskSurface || !isNativeKioskWrapper) return;

  let notified = false;
  const notifyIfRendered = () => {
    if (notified) return true;

    const quarantine = document.querySelector(".kiosk-quarantine");
    const kioskRoot = document.querySelector(".kiosk-root");
    const main = document.querySelector("main");
    const renderedRoot = quarantine ?? kioskRoot ?? main;
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

  // Catch both an immediately rendered gate and a later async transition from
  // the recovery/loading state. The observer disconnects permanently after the
  // first successful handshake, so it has no steady-state kiosk cost.
  if (notifyIfRendered()) return;
  const observer = new MutationObserver(() => {
    if (notifyIfRendered()) observer.disconnect();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  // Safety retry for old WebViews where MutationObserver delivery can lag while
  // the main thread is busy with first paint. Still well inside the APK's 20s.
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

// Register the PWA only on kiosk routes. Registering it from the public website,
// customer account or administration can leave those pages on an obsolete app
// shell after a new publication.
if (isKioskSurface && !isStaticHashPreview && !isNativeKioskWrapper) {
  initKioskPwa();
} else if ("serviceWorker" in navigator) {
  // Remove kiosk service workers from non-kiosk pages, static previews and
  // the native Android wrapper. This is intentionally best-effort and does
  // not block rendering when the browser denies access.
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
