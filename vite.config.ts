import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

const manualChunks = (id: string) => {
  const normalized = id.replace(/\\/g, "/");

  // Keep kiosk-critical application code in the entry chunk while moving
  // back-office/account surfaces out of it. These remain static chunks (not
  // React.lazy/dynamic imports), preserving compatibility with the old kiosk
  // WebView target while avoiding one monolithic 1.4+ MB bundle.
  if (normalized.includes("/src/pages/admin/") || normalized.includes("/src/components/admin/")) return "admin-app";
  if (normalized.includes("/src/pages/account/") || normalized.includes("/src/components/account/")) return "account-app";

  if (!normalized.includes("/node_modules/")) return undefined;

  if (
    normalized.includes("/node_modules/react/")
    || normalized.includes("/node_modules/react-dom/")
    || normalized.includes("/node_modules/react-router/")
    || normalized.includes("/node_modules/react-router-dom/")
    || normalized.includes("/node_modules/@tanstack/")
  ) return "react-core";

  if (
    normalized.includes("/node_modules/@radix-ui/")
    || normalized.includes("/node_modules/cmdk/")
    || normalized.includes("/node_modules/vaul/")
    || normalized.includes("/node_modules/sonner/")
  ) return "ui-core";

  if (normalized.includes("/node_modules/lucide-react/")) return "icons";
  if (normalized.includes("/node_modules/@supabase/")) return "supabase";
  if (
    normalized.includes("/node_modules/recharts/")
    || normalized.includes("/node_modules/d3-")
    || normalized.includes("/node_modules/victory-vendor/")
  ) return "charts";
  if (
    normalized.includes("/node_modules/framer-motion/")
    || normalized.includes("/node_modules/motion-dom/")
    || normalized.includes("/node_modules/motion-utils/")
  ) return "motion";

  return undefined;
};

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  // The embedded tablet runs Android 8+ (minSdk 26), whose System WebView
  // can be substantially older than Vite's moving browser baseline. Keep
  // the kiosk bundle compatible with Chromium 61 instead of shipping syntax
  // that renders a native WebView as an empty page before React can recover.
  build: {
    target: "chrome61",
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
  define: {
    __APP_BUILD__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      // The kiosk wrapper (src/pwa/registerSW.ts) is the ONLY registrar.
      injectRegister: null,
      // "prompt": we control when the new SW activates so we never reload
      // during an active rental or payment.
      registerType: "prompt",
      filename: "sw.js",
      // No SW in dev / Lovable preview.
      devOptions: { enabled: false },
      includeAssets: ["favicon.ico", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "chargeurs-plus-push-sw.js"],
      manifest: {
        name: "Chargeurs.ch Kiosk",
        short_name: "Chargeurs Kiosk",
        description: "Borne self-service de location de batteries Chargeurs.ch",
        // start_url resolves the locked cabinet from local storage (see /kiosk route).
        start_url: "/kiosk",
        scope: "/",
        display: "fullscreen",
        display_override: ["fullscreen", "standalone"],
        orientation: "portrait",
        background_color: "#0a1024",
        theme_color: "#0a1024",
        lang: "fr",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // The same service worker controls kiosk and account routes. Push handlers
        // are inert unless a signed-in Chargeurs+ user explicitly subscribes.
        importScripts: ["/chargeurs-plus-push-sw.js"],
        // Precache the built app shell (hashed JS/CSS + icons).
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff,woff2}"],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: false,
        // OAuth callback must never be served from cache / fallback.
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/~oauth/, /^\/admin/, /\/functions\//, /\/rest\//, /\/auth\//],
        runtimeCaching: [
          {
            // HTML navigations: always try the network first (fresh app shell).
            urlPattern: ({ request }) => request.mode === "navigate",
            handler: "NetworkFirst",
            options: {
              cacheName: "kiosk-html",
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
          {
            // Advertising media is the only Supabase cross-origin content allowed
            // in the kiosk cache. This keeps already-seen campaigns playing during
            // a temporary venue connection loss without caching any dynamic API.
            urlPattern: ({ url }) =>
              url.origin === "https://xqepbqnaenoeyfjkjnzl.supabase.co"
              && url.pathname.startsWith("/storage/v1/object/public/advertising-media/"),
            handler: "CacheFirst",
            options: {
              cacheName: "kiosk-advertising-media",
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            // Same-origin hashed static assets only.
            urlPattern: ({ url, request, sameOrigin }) =>
              sameOrigin && ["style", "script", "worker", "font", "image"].includes(request.destination) && !url.pathname.startsWith("/sw.js"),
            handler: "CacheFirst",
            options: {
              cacheName: "kiosk-assets",
              expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          // NOTE: Stripe, ChargeNow and all dynamic Supabase API calls remain
          // network-only. Payment QR, rental state and battery data are never cached.
        ],
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
}));
