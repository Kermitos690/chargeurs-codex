// Kiosk PWA service-worker registration — the ONLY registrar in the app.
// Refuses to register in dev / Lovable preview / iframe and supports ?sw=off.
// Update activation is controlled so the app never visibly reloads after a
// rental, payment, or cancellation.
import { registerSW } from "virtual:pwa-register";

let _updateSW: ((reload?: boolean) => Promise<void>) | null = null;
let _swVersionUrl: string | null = null;
let _needRefresh = false;
const listeners = new Set<(needRefresh: boolean) => void>();

function emit() {
  for (const l of listeners) l(_needRefresh);
}

export function subscribeNeedRefresh(cb: (needRefresh: boolean) => void): () => void {
  listeners.add(cb);
  cb(_needRefresh);
  return () => listeners.delete(cb);
}

export function getSwScriptUrl(): string | null {
  return _swVersionUrl;
}

export function isUpdateWaiting(): boolean {
  return _needRefresh;
}

// Activate the pending worker without reloading the currently displayed kiosk.
// This is deliberate: after a confirmed cancellation the React state can return
// directly to Home, instead of briefly showing a terminal state and then a blue
// app boot screen. The activated worker serves the fresh bundle on the next
// natural page load / native app restart.
export async function applyKioskUpdate(): Promise<void> {
  if (_updateSW && _needRefresh) {
    await _updateSW(false);
    _needRefresh = false;
    emit();
  }
}

function isBlockedContext(): boolean {
  if (!import.meta.env.PROD) return true;
  try {
    if (window.top !== window.self) return true;
  } catch {
    return true;
  }
  const h = window.location.hostname;
  if (h.startsWith("id-preview--") || h.startsWith("preview--")) return true;
  if (h === "lovableproject.com" || h.endsWith(".lovableproject.com")) return true;
  if (h === "lovableproject-dev.com" || h.endsWith(".lovableproject-dev.com")) return true;
  if (h === "beta.lovable.dev" || h.endsWith(".beta.lovable.dev")) return true;
  if (new URLSearchParams(window.location.search).get("sw") === "off") return true;
  return false;
}

export function initKioskPwa(): void {
  if (isBlockedContext()) {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) =>
          regs.forEach((r) => {
            if (r.active?.scriptURL.endsWith("/sw.js")) r.unregister();
          }),
        )
        .catch(() => {});
    }
    return;
  }

  _updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      _needRefresh = true;
      emit();
    },
    onRegisteredSW(swUrl, reg) {
      _swVersionUrl = swUrl;
      // Re-check for a new version hourly (kiosks stay open for days).
      if (reg) {
        setInterval(() => {
          reg.update().catch(() => {});
        }, 60 * 60 * 1000);
      }
    },
  });
}
