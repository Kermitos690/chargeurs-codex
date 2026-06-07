import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
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
      includeAssets: ["favicon.ico", "icon-192.png", "icon-512.png", "icon-maskable-512.png"],
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
            // Same-origin hashed static assets only.
            urlPattern: ({ url, request, sameOrigin }) =>
              sameOrigin && ["style", "script", "worker", "font", "image"].includes(request.destination) && !url.pathname.startsWith("/sw.js"),
            handler: "CacheFirst",
            options: {
              cacheName: "kiosk-assets",
              expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          // NOTE: Supabase / Stripe / ChargeNow requests are cross-origin and have
          // NO runtime caching entry, so they are always network-only. Payment QR,
          // rental status, battery status and any dynamic data are never cached.
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
