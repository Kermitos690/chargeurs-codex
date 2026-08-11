# Vercel main redeploy trigger — Inventory admin — 2026-08-12

Purpose: force the Git → Vercel integration to build and promote the current `main` after PR #115 merged, because the production alias `chargeurs-ch-staging.vercel.app` was still serving an older `main` deployment and therefore did not expose the newly merged super-admin Inventory navigation and `/admin/inventory` surface.

This is documentation-only. It changes no application behavior, payment, pricing, rental/session, ChargeNow hardware control, kiosk flow, advertising runtime, supplier order, or inventory data.
