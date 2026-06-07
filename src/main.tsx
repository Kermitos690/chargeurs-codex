import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initKioskPwa } from "./pwa/registerSW";

createRoot(document.getElementById("root")!).render(<App />);

// Register the kiosk service worker (guarded: no-op in dev / Lovable preview).
initKioskPwa();
