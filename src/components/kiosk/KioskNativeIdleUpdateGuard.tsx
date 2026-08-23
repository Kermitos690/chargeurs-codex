import { useEffect, useRef } from "react";

const FIRST_PROBE_MS = 20_000;
const PROBE_INTERVAL_MS = 60_000;
const SAFE_RECHECK_MS = 1_500;

function isNativeKioskSurface() {
  const path = window.location.pathname;
  const kioskPath = path === "/kiosk" || path.startsWith("/kiosk/");
  if (!kioskPath) return false;
  if (document.documentElement.dataset.kioskNativeRuntime === "true") return true;
  if (/\bChargeursKiosk\//i.test(navigator.userAgent || "")) return true;
  return "ChargeursNative" in window;
}

function normalizedAssetPath(raw: string): string | null {
  try {
    return new URL(raw, window.location.origin).pathname;
  } catch {
    return null;
  }
}

function assetSignature(doc: Document): string | null {
  const scripts = Array.from(doc.querySelectorAll<HTMLScriptElement>('script[type="module"][src]'))
    .map((script) => normalizedAssetPath(script.src))
    .filter((path): path is string => Boolean(path && /\/assets\/index-[^/?]+\.js$/.test(path)));

  const styles = Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]'))
    .map((link) => normalizedAssetPath(link.href))
    .filter((path): path is string => Boolean(path && /\/assets\/index-[^/?]+\.css$/.test(path)));

  const assets = [...scripts, ...styles].sort();
  return assets.length ? assets.join("|") : null;
}

async function currentlyServedSignature(): Promise<string | null> {
  const url = `/index.html?__chargeurs_kiosk_build_probe=${Date.now()}`;
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Cache-Control": "no-cache" },
  });
  if (!response.ok) return null;
  const html = await response.text();
  const parsed = new DOMParser().parseFromString(html, "text/html");
  return assetSignature(parsed);
}

function safeToReload() {
  const root = document.documentElement;
  const scene = root.dataset.kioskScene ?? "";
  // The return/settlement UI is rendered outside the V3 product scene as a
  // high-priority fixed overlay. Any visible z-[120] full-screen overlay means
  // the customer flow is not idle yet, even if the product layer says Home.
  const returnOverlay = document.querySelector('div.fixed.inset-0[class*="z-[120]"]');
  return scene === "home" && !returnOverlay;
}

/**
 * Native Android kiosks deliberately do not register the PWA service worker.
 * They can therefore stay on old in-memory JS or CSS assets after a staging
 * deployment. This guard compares the complete loaded Vite entry signature
 * (JS + CSS) with what Vercel currently serves. A mismatch is applied only
 * after the kiosk is back on Home and no return/receipt overlay is visible.
 *
 * Presentation/deployment lifecycle only: no rental, payment, pricing, stock,
 * ChargeNow or hardware command is issued from this component.
 */
export function KioskNativeIdleUpdateGuard() {
  const pendingRef = useRef(false);
  const reloadingRef = useRef(false);

  useEffect(() => {
    if (!isNativeKioskSurface()) return;
    const loadedSignature = assetSignature(document);
    if (!loadedSignature) return;

    const applyIfSafe = () => {
      if (!pendingRef.current || reloadingRef.current || !safeToReload()) return;
      reloadingRef.current = true;
      window.location.reload();
    };

    const probe = async () => {
      if (reloadingRef.current) return;
      try {
        const servedSignature = await currentlyServedSignature();
        if (servedSignature && servedSignature !== loadedSignature) {
          pendingRef.current = true;
          applyIfSafe();
        }
      } catch {
        // Network loss must never disturb an active or idle kiosk.
      }
    };

    const first = window.setTimeout(() => void probe(), FIRST_PROBE_MS);
    const probes = window.setInterval(() => void probe(), PROBE_INTERVAL_MS);
    const safeChecks = window.setInterval(applyIfSafe, SAFE_RECHECK_MS);
    const flowComplete = () => applyIfSafe();
    const online = () => void probe();
    const visible = () => {
      if (document.visibilityState === "visible") void probe();
    };

    window.addEventListener("chargeurs:kiosk-flow-complete", flowComplete);
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", visible);

    return () => {
      window.clearTimeout(first);
      window.clearInterval(probes);
      window.clearInterval(safeChecks);
      window.removeEventListener("chargeurs:kiosk-flow-complete", flowComplete);
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);

  return null;
}
