# Architecture Chargeurs.ch

Status date: **2026-08-29**
Audit baseline: 410dac320278b32f66cab08a801fda8edd46d784

This document separates current staging runtime from target architecture. The
authority for resolving facts is docs/SYSTEM_OF_RECORD.md.

## Current Architecture Decision — 2026-08-29

| Domain | Decision |
|---|---|
| Repository | Kermitos690/chargeurs-codex |
| Mainline | main |
| Staging frontend | Vercel, pending ownership/provenance reconciliation |
| Staging backend | Supabase xqepbqnaenoeyfjkjnzl |
| Staging payments | Stripe TEST only |
| Cloudflare | Parallel experiment only; no fleet cutover authorized |
| Android | No canonical staging APK |
| Production | NOT CONFIGURED / NO-GO |

## Current staging runtime

~~~mermaid
flowchart TD
    A["Android kiosk WebView"] --> B["Vercel staging frontend"]
    C["Customer browser"] --> B
    B --> D["Supabase staging"]
    D --> E["Stripe TEST"]
    D --> F["ChargeNow / stations"]
~~~

Current responsibilities:

| Component | Function | Current limitation |
|---|---|---|
| Vercel | Serves the Vite/React app and rewrites allowlisted kiosk API paths | Active project owner and deployed source SHA are not reconciled |
| Supabase staging | PostgreSQL, Auth, Edge Functions, Storage, Cron, RPC/RLS and integration state | Migration and function source sets diverge from main |
| Stripe TEST | Test payment objects and signed webhooks | LIVE is not authorized or proven configured |
| ChargeNow | Cabinet/provider events and commands behind server controls | Controlled end-to-end physical proof remains incomplete |
| Android kiosks | Enrollment, protected local configuration, WebView and native bridge | Three field version labels; no canonical artifact provenance |

Vercel's CLI --prod currently refers to the production slot of a Vercel project
named chargeurs-ch-staging. It is not Chargeurs.ch production.

## Cloudflare experiment

Cloudflare Pages currently serves a different parallel frontend build at
chargeurs-ch-staging-cf.pages.dev. Its branch also contains proxy, Workers AI,
auth, Android, migration, Stripe and diagnostic changes. It is therefore an
ACTIVE_EXPERIMENT, not a release source.

- No station is authorized to migrate to Cloudflare.
- PR #338 must be split by functional domain.
- PR #341 must not be merged.
- A public/diagnostic rescue function must never relay a hardware mutation.
- If Cloudflare evaluation continues, one wrangler.jsonc should become its
  canonical configuration in a later non-documentation PR.

## Source/runtime divergence

| Area | Source truth at baseline | Runtime/field truth |
|---|---|---|
| Web | main plus multiple Vercel/Cloudflare branches | Vercel serves fleet; exact source SHA unknown |
| DB migrations | 151 files / 149 unique versions | 257 staging ledger entries |
| Edge Functions | 59 function directories | 100 active functions |
| Android | main normal line 1.0.51 / Terminal SDK 3.0.0 | DTA21269 1.0.35, DTA21277 1.0.58 label, DTA22032 1.0.33 label |
| Pricing | Multiple historical documents/PRs | Active DB profile for new rentals; immutable snapshot for an existing rental |
| Production | Target documents and workflow terminology | No complete production environment proven |

## Sources of truth

- PostgreSQL runtime owns current locations, pricing profiles, stations,
  payments projections, inventory and audits for its environment.
- An immutable rental pricing snapshot owns the price contract for that rental.
- A verified Stripe webhook plus Stripe object is payment proof. A browser
  success_url redirect is never payment proof.
- The Rental Orchestrator is the target owner of critical idempotent state
  transitions; deployed version parity remains to be proven.
- Authenticated ChargeNow callback/read-back plus physical correlation is proof
  of ejection or return. A command request or UI message is not proof.
- Installed Android package metadata and signer read from the device/APK are
  field truth. A similar branch version name is not provenance.

## Security boundaries

- The browser cannot choose price, currency, slot or final state.
- A kiosk must use an individual revocable credential bound to one station.
- Android enrollment uses a one-time flow and protected local storage.
- Privileged payment and hardware mutations remain server-side.
- Local hardware commands require short-lived, scoped and replay-protected
  authorization where that bridge is enabled.
- Unknown protocols, callers or authorization mechanisms fail the release gate;
  they are not filled in by assumption.
- verify_jwt=false requires documentation of the effective custom
  authentication before the endpoint can be approved.

## Repository modules

| Path | Dedicated function |
|---|---|
| src/pages, src/components, src/lib | Public, kiosk, customer and admin web application |
| supabase/migrations | Intended forward schema history; not canonical until reconciliation |
| supabase/functions | Intended Edge Function source; incomplete relative to runtime |
| openapi, docs/openapi | Platform API contracts |
| android-kiosk | Android wrapper, enrollment, WebView, Terminal/native integration |
| .github/workflows | Current CI/deploy/diagnostic automation; convergence deferred to PR 2 |
| docs | Runtime truth, architecture, evidence and historical records |

## Payment architecture

The web flow supports Stripe Checkout/PaymentIntent patterns and the Android
history includes Stripe Terminal lines. Exact enabled methods and commercial
values are environment runtime facts.

Required invariant:

1. server creates the financial object from a versioned pricing snapshot;
2. trusted Stripe evidence advances payment state idempotently;
3. only the winning payment rail may authorize a release;
4. final capture/cancellation/refund follows the rental snapshot and verified
   return/non-return state;
5. frontend redirects and client messages never finalize payment.

## Android architecture

The target Android line provides:

- one staging package and one later production package;
- reproducible build manifest and exact source SHA;
- APK and signer SHA-256;
- explicit enrollment and runtime origins;
- declared Stripe Terminal SDK and reader mode;
- hardware-ejection feature state;
- upgrade and rollback compatibility.

This target is not achieved. See docs/STATION_RUNTIME_MATRIX.md.

## Environment architecture

| Environment | Current status |
|---|---|
| Local | Source exists; full clean reconstruction is UNKNOWN pending migration convergence |
| Staging | Active on Vercel + Supabase xqepbqnaenoeyfjkjnzl; not yet reproducible from one source set |
| Cloudflare experiment | Active parallel host using the staging backend; non-canonical |
| Production | NOT CONFIGURED / NO-GO |

Lovable origins and older Supabase projects found in historical repositories are
HISTORICAL. They are not current runtime authorities unless future evidence
demonstrates an active dependency.

## Target architecture

The target is one canonical repo/mainline, one reproducible staging deployment,
one reconciled migration history, one Edge Function source set, one Android
staging line and a separately defined production architecture. None of those
runtime-convergence claims may be marked achieved solely because this document
describes them.

## Critical prohibitions

- no blind database push;
- no migration timestamp rewriting against staging;
- no mass function deletion;
- no Cloudflare fleet cutover;
- no monolithic #338 merge and no #341 merge;
- no APK selection by version number alone;
- no Stripe LIVE use;
- no hardware mutation through diagnostic/public rescue surfaces;
- no interpretation of pre-run GitHub failures as failed tests.
