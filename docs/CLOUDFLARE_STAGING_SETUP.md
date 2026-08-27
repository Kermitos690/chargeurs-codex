# Cloudflare staging setup

This migration is intentionally frontend-hosting-only. Supabase, Stripe, ChargeNow, kiosk authentication, pricing and hardware semantics remain unchanged.

## Initial Pages project

Use Cloudflare Pages with the existing GitHub repository.

- Repository: `Kermitos690/chargeurs-codex`
- Project name: `chargeurs-ch-staging-cf`
- Production branch for initial validation: `feat/cloudflare-staging-20260827`
- Framework preset: Vite
- Build command: `npm run build`
- Build output directory: `dist`
- Root directory: repository root

No private Supabase service-role key, Stripe secret, ChargeNow secret or kiosk device token belongs in Cloudflare Pages.

The browser Supabase client currently has an explicit public staging fallback for `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, so those variables are not required for the initial staging build. They may still be configured explicitly later for clarity.

## Vercel compatibility reproduced on Cloudflare

`public/_headers` preserves the important static cache behavior for the kiosk shell and `index.html`.

`functions/api/kiosk/[[path]].js` mirrors the existing Vercel `/api/kiosk/*` rewrites with an explicit allowlist. It forwards the original request method, query string, browser/kiosk authorization headers and body to the exact existing Supabase Edge Function endpoint. Unknown `/api/kiosk/*` paths fail closed with 404.

Cloudflare Pages' default SPA behavior is used for client-side routes. Do not add a top-level `404.html` unless the SPA fallback is replaced deliberately.

## Deployment-budget policy

Cloudflare Pages can build on pushes and pull requests. To avoid repeating the Vercel quota incident, keep preview builds disabled or tightly restricted once the project is validated. Production should eventually build only from `main` after this migration PR is reviewed and merged.

Do not create no-op/retry commits merely to trigger hosting.

## Validation before any kiosk cutover

1. Cloudflare build completes successfully.
2. Root page and kiosk route render on the `*.pages.dev` URL.
3. A non-mutating kiosk API read through `/api/kiosk/*` reaches the expected Supabase function and preserves 401/403 semantics when credentials are absent.
4. Authenticated kiosk telemetry is observed only after the native kiosk is deliberately pointed at the Cloudflare staging URL.
5. No Stripe LIVE payment, ChargeNow mutation or physical ejection is used for hosting validation.
6. Only after validation should the production branch be moved to `main` and any kiosk URL/domain cutover be considered.

## Rollback

Vercel configuration is not deleted by this migration branch. Until Cloudflare is validated, the previous host remains available as a rollback reference even though its account/deployment status may currently be blocked.
