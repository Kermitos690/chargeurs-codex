import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

function vendorChunk(id: string): string | undefined {
  if (!id.includes("node_modules")) return undefined;

  // Match specific ecosystems before React core: packages such as
  // react-router-dom, lucide-react and react-hook-form also contain "react".
  if (id.includes("react-router")) return "vendor-router";
  if (id.includes("@tanstack")) return "vendor-query";
  if (id.includes("@supabase")) return "vendor-supabase";
  if (id.includes("@radix-ui") || id.includes("cmdk") || id.includes("vaul")) return "vendor-ui";
  if (id.includes("lucide-react")) return "vendor-icons";
  if (id.includes("recharts") || id.includes("d3-")) return "vendor-charts";
  if (id.includes("zod") || id.includes("react-hook-form") || id.includes("@hookform")) return "vendor-forms";
  if (id.includes("qrcode") || id.includes("html5-qrcode")) return "vendor-qr";
  if (
    id.includes("/node_modules/react/") ||
    id.includes("/node_modules/react-dom/") ||
    id.includes("/node_modules/scheduler/")
  ) return "vendor-react";

  return "vendor-misc";
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
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
              expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          // NOTE: Supabase / Stripe / ChargeNow requests are cross-origin and have
          // NO runtime caching entry, so they are always network-only. Payment QR,
          // rental status, battery status and any dynamic data are never cached.
        ],
      },
    }),
  ].filter(Boolean),
  build: {
    rollupOptions: {
      output: {
        manualChunks: vendorChunk,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
}));
