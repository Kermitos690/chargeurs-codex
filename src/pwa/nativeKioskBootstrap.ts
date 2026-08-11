const APP_SHELL_CACHE_MARKERS = ["workbox-precache", "kiosk-html", "kiosk-assets"];

function currentBundleToken(): string {
  try {
    const url = new URL(import.meta.url);
    return url.pathname.split("/").filter(Boolean).pop() ?? "current";
  } catch {
    return "current";
  }
}

async function purgeLegacyAppShell(): Promise<boolean> {
  let hadLegacyShell = false;

  if ("serviceWorker" in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      const kioskRegistrations = registrations.filter((registration) =>
        registration.active?.scriptURL.endsWith("/sw.js") ||
        registration.waiting?.scriptURL.endsWith("/sw.js") ||
        registration.installing?.scriptURL.endsWith("/sw.js"),
      );
      if (navigator.serviceWorker.controller || kioskRegistrations.length > 0) hadLegacyShell = true;
      await Promise.all(kioskRegistrations.map((registration) => registration.unregister()));
    } catch {
      // Best effort: kiosk can still continue from the network.
    }
  }

  if ("caches" in window) {
    try {
      const cacheNames = await caches.keys();
      const staleAppCaches = cacheNames.filter((name) =>
        APP_SHELL_CACHE_MARKERS.some((marker) => name.includes(marker)),
      );
      if (staleAppCaches.length > 0) hadLegacyShell = true;
      await Promise.all(staleAppCaches.map((name) => caches.delete(name)));
    } catch {
      // CacheStorage can be denied on some old/locked WebViews.
    }
  }

  return hadLegacyShell;
}

/**
 * Native Android kiosk bootstrap.
 *
 * The native wrapper owns online/offline lifecycle, so an old browser service
 * worker must never be allowed to restore a stale React app shell. This runs
 * before React mounts, preserves all kiosk/session storage, purges only web app
 * shell caches, and performs at most one cache-busting navigation per bundle.
 */
export async function prepareNativeKioskBootstrap(
  isKioskSurface: boolean,
  isNativeKioskWrapper: boolean,
): Promise<"ready" | "reloading"> {
  if (!isKioskSurface || !isNativeKioskWrapper) return "ready";

  document.documentElement.classList.add("kiosk-native-preboot");
  document.documentElement.style.background = "#020713";
  document.body.style.background = "#020713";

  const token = currentBundleToken();
  const markerKey = `chargeurs:native-shell:${token}`;
  let alreadyPrepared = false;
  try {
    alreadyPrepared = sessionStorage.getItem(markerKey) === "1";
  } catch {
    // Session storage can be unavailable in hardened WebViews.
  }

  const hadLegacyShell = await purgeLegacyAppShell();
  if (alreadyPrepared) return "ready";

  try {
    sessionStorage.setItem(markerKey, "1");
  } catch {
    // The query parameter below is the second loop guard.
  }

  const url = new URL(window.location.href);
  if (url.searchParams.get("__kiosk_build") === token && !hadLegacyShell) return "ready";

  url.searchParams.set("__kiosk_build", token);
  // Unregistering a controlling SW only releases the *next* navigation. A
  // replace now guarantees that next navigation comes from the network/WebView
  // cache-busted URL instead of the stale app-shell controller.
  window.location.replace(url.toString());
  return "reloading";
}
