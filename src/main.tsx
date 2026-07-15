import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
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

// Register the PWA only on kiosk routes. Registering it from the public website,
// customer account or administration can leave those pages on an obsolete app
// shell after a new publication.
if (isKioskSurface && !isStaticHashPreview) {
  initKioskPwa();
} else if ("serviceWorker" in navigator) {
  // Remove kiosk service workers from non-kiosk pages and static previews.
  // This is intentionally best-effort and does not block rendering when the
  // browser denies access.
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
