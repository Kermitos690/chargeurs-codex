# Chargeurs.ch — Deployment Matrix

Status date: **2026-08-29**
Audit baseline: `410dac320278b32f66cab08a801fda8edd46d784`

This matrix separates observed runtime from target architecture. `UNKNOWN` and
`NOT CONFIGURED` are intentional values and must not be replaced by assumptions.

## Current Architecture Decision — 2026-08-29

- Repository: `Kermitos690/chargeurs-codex`
- Mainline: `main`
- Staging frontend: Vercel, pending ownership/provenance reconciliation
- Staging backend: Supabase `xqepbqnaenoeyfjkjnzl`
- Staging payments: Stripe TEST only
- Cloudflare: parallel experiment only
- Android: no canonical staging APK
- Production: `NOT CONFIGURED` / `NO-GO`

## Environment matrix

| Environment | Frontend | Backend | DB | Payments | Hardware | Android | Domain | Status |
|---|---|---|---|---|---|---|---|---|
| Local | Vite development server | Local source exists; full local Supabase runtime not proven reproducible | Local reconstruction `UNKNOWN` because migration history is not reconciled | TEST/mock configuration only; exact local setup `UNKNOWN` | `NONE` | Debug source/build capability exists; canonical debug artifact `UNKNOWN` | `localhost` | `UNKNOWN` / development only |
| Staging | **Vercel is the current canonical runtime** | Supabase Edge Functions | Supabase `xqepbqnaenoeyfjkjnzl` (`chargeurs-ch-staging`) | Stripe TEST only | Controlled staging stations; mutation permissions must remain gated | Three different installed version labels; no canonical staging APK | `https://chargeurs-ch-staging.vercel.app` | Active but not reproducible from a single proven source set |
| Cloudflare experiment | Cloudflare Pages parallel build | Pages proxy to the same Supabase staging functions plus experimental Pages Functions | Same Supabase staging DB; no isolated Cloudflare DB | Stripe TEST indirectly through staging backend; exact parity `UNKNOWN` | No station is authorized to use this host | Experimental Cloudflare-origin branches only; no approved APK | `https://chargeurs-ch-staging-cf.pages.dev` | `ACTIVE_EXPERIMENT`, non-canonical |
| Production | `NOT CONFIGURED` | `NOT CONFIGURED` | No Chargeurs.ch production Supabase project proven | Stripe LIVE is not authorized or proven configured | `NOT CONFIGURED` | No production-signed release APK | Production domain `UNKNOWN` | `NO-GO` |

## Vercel terminology warning

The workflow named `Vercel Prebuilt Production` uses Vercel CLI `--prod` and
pulls the `production` environment of a Vercel project named
`chargeurs-ch-staging`. In the observed configuration, this means **the Vercel
production slot of the staging project**. It does not demonstrate or authorize
a Chargeurs.ch production environment.

Additional unresolved Vercel facts:

- Git deployment is disabled in `vercel.json`.
- Multiple explicit prebuilt/direct deployment workflows coexist.
- Workflows reference different historical team/project/scope identifiers.
- The currently visible Vercel workspace does not expose the deployed project.
- The exact source commit of the asset currently served to the stations is
  `UNKNOWN`.

## Staging request path

Observed canonical request path:

1. A station opens its Vercel `kiosk_url`.
2. Vercel serves the Vite/React frontend.
3. The frontend calls allowlisted `/api/kiosk/*` paths.
4. Vercel rewrites those paths to Supabase Edge Functions in
   `xqepbqnaenoeyfjkjnzl`.
5. Supabase owns database, Auth, pricing, payment orchestration and provider
   integration state.

This path describes current runtime. It does not prove that the Vercel bundle,
the 100 deployed Edge Functions and `main` were built from the same commit.

## Cloudflare boundary

Cloudflare currently serves a different frontend artifact. It is retained for
evaluation only. No station migration, DNS cutover or backend divergence is
authorized. PR #338 and PR #341 are not release sources.

## Production entry conditions

Production stays `NO-GO` until all of the following are separately proven:

- a distinct production frontend project and owner;
- a distinct production Supabase project and migration baseline;
- environment-separated secrets and Stripe LIVE webhook ownership;
- a production domain and rollback plan;
- a production-signed Android artifact with verified provenance;
- backup and restore validation;
- approved ChargeNow and physical hardware procedures;
- an explicit production GO decision recorded after staging PASS.

No production deploy command is provided by this documentation phase.
