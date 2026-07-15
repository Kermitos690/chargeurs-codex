import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initKioskPwa } from "./pwa/registerSW";

createRoot(document.getElementById("root")!).render(<App />);

// The service worker belongs to the kiosk surface only. Registering it from the
// public website, customer account or administration can leave those pages on
// an obsolete cached app shell after a new Lovable publication.
const hashPath = window.location.hash.replace(/^#/, "");
const isKioskSurface =
  window.location.pathname === "/kiosk" ||
  window.location.pathname.startsWith("/kiosk/") ||
  hashPath === "/kiosk" ||
  hashPath.startsWith("/kiosk/");

if (isKioskSurface) {
  initKioskPwa();
} else if ("serviceWorker" in navigator) {
  // Remove kiosk service workers from non-kiosk pages. This is intentionally
  // best-effort and does not block rendering when the browser denies access.
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
