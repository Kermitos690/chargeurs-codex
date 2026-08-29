# Chargeurs.ch — System of Record

Status date: **2026-08-29**
Audit baseline: `410dac320278b32f66cab08a801fda8edd46d784`

This document is the authoritative index for determining which system owns a
given fact. It records the observed state; it does not deploy, migrate, enable,
disable or repair anything.

## Truth vocabulary

| Label | Meaning |
|---|---|
| `SOURCE_TRUTH` | Reviewed source intended to become reproducible from `main`. Source presence does not prove deployment. |
| `RUNTIME_TRUTH` | State directly observed in a deployed service. Runtime presence does not prove that Git contains its source. |
| `FIELD_TRUTH` | State directly reported by or verified on a physical station/tablet. A database label alone is not complete APK provenance. |
| `TARGET_ARCHITECTURE` | Approved destination, not yet necessarily implemented. |
| `UNKNOWN` | Evidence is absent, inaccessible or insufficient. No value may be inferred. |
| `NO-GO` | The action or environment is not authorized for release or mutation. |

## Current Architecture Decision — 2026-08-29

| Decision | Current authority |
|---|---|
| Repository | `Kermitos690/chargeurs-codex` |
| Mainline | `main` |
| Audit baseline | `410dac320278b32f66cab08a801fda8edd46d784` |
| Staging frontend | Vercel, pending ownership and deployment-provenance reconciliation |
| Staging backend | Supabase `xqepbqnaenoeyfjkjnzl` (`chargeurs-ch-staging`) |
| Staging payments | Stripe TEST only |
| Cloudflare | Parallel experiment only; not canonical and not used by the fleet |
| Android | No canonical staging APK exists |
| Production | `NOT CONFIGURED` / `NO-GO` |

No station migration to Cloudflare is authorized. No production deployment is
authorized.

## Ownership by type of fact

| Fact | System of record | Truth class | Important boundary |
|---|---|---|---|
| GitHub source code | `Kermitos690/chargeurs-codex` on `main` | `SOURCE_TRUTH` | Feature branches and PRs may contain unique work, but are not canonical until selectively converged. |
| Git history | Git commit graph and reviewed PR history | `SOURCE_TRUTH` | A commit or merged PR does not prove deployment. |
| Database state | PostgreSQL in the environment-specific Supabase project | `RUNTIME_TRUTH` | Staging is `xqepbqnaenoeyfjkjnzl`; no production project is proven. |
| Intended database schema | Reconciled migration history in `supabase/migrations` | `TARGET_ARCHITECTURE` | It is not canonical today because Git and the staging ledger diverge. |
| Applied migration ledger | `supabase_migrations.schema_migrations` in the target project | `RUNTIME_TRUTH` | A ledger row proves recorded application, not semantic equivalence to a similarly named Git file. |
| Deployed Edge Functions | Supabase runtime function inventory, versions and bundle hashes | `RUNTIME_TRUTH` | There are runtime-only functions; Git presence alone does not prove the deployed version. |
| Intended Edge Function source | Reviewed function source in `supabase/functions` | `SOURCE_TRUTH` after convergence | The current source set is incomplete relative to staging runtime. |
| Authentication state | Supabase Auth configuration and runtime grants/policies | `RUNTIME_TRUTH` | Documentation and client assumptions are not proof of effective access. |
| Storage state | Supabase Storage buckets, policies and object metadata | `RUNTIME_TRUTH` | Repository policies are only intended state until matched to runtime. |
| Cron/webhook scheduling | Active Supabase Cron jobs and registered provider endpoints | `RUNTIME_TRUTH` | A function with no Git caller can still be invoked by Cron or an external webhook. |
| Stripe payment state | Stripe object plus a verified Stripe webhook processed server-side | `RUNTIME_TRUTH` | A browser success redirect is **never payment proof**. |
| Payment accounting projection | Reconciled Supabase payment/rental records derived from trusted Stripe events | `RUNTIME_TRUTH` | Browser or kiosk state cannot finalize a payment. |
| ChargeNow ejection/return | Authenticated provider callback, read-back or controlled reconciliation evidence | `FIELD_TRUTH` plus `RUNTIME_TRUTH` | A command request is not proof that a battery physically moved. |
| Physical release/return | Correlated hardware event for station, slot, battery and rental | `FIELD_TRUTH` | UI success text is not physical proof. |
| Station enrollment/configuration | Active `kiosk_devices` and `stations` rows in the environment DB | `RUNTIME_TRUTH` | Tokens remain secret; kiosk URL changes require an approved rollback plan. |
| Installed Android runtime | Package metadata and signer read from the actual device/APK | `FIELD_TRUTH` | `app_version` in Supabase is supporting evidence, not complete provenance. |
| Android intended source | Reviewed `android-kiosk/` source plus reproducible artifact manifest | `SOURCE_TRUTH` / `TARGET_ARCHITECTURE` | No current branch is designated `CANONICAL_STAGING_APK`. |
| Vercel staging deployment | Active Vercel project/deployment metadata and served asset | `RUNTIME_TRUTH` | The exact owner/project/source SHA still requires reconciliation. |
| Cloudflare deployment | Active Pages project/deployment metadata and served asset | `RUNTIME_TRUTH` for the experiment | It is not the staging fleet authority. |
| Active pricing for new rentals | Active versioned price profile and server-generated snapshot in staging DB | `RUNTIME_TRUTH` | README values and UI text are not pricing authority. |
| Pricing for an existing rental | Immutable rental pricing snapshot and its integrity evidence | `RUNTIME_TRUTH` | Later price-profile changes must not reinterpret an existing rental. |
| Audit records | Append-only database/provider audit evidence and immutable CI/release manifests | `RUNTIME_TRUTH` | A mutable status marker committed by a workflow is not sufficient release evidence. |

## Known divergence at the baseline

- `main` is canonical source direction but does not fully represent staging.
- Staging has 257 migration-ledger entries while `main` has 151 SQL files and
  149 unique migration versions.
- Staging has 100 active Edge Functions while `main` has 59 function
  directories.
- The three known stations report three different Android application version
  labels.
- Vercel serves the fleet today; Cloudflare serves a different parallel build.
- No Chargeurs.ch production Supabase project, frontend project, domain,
  Stripe LIVE configuration or production-signed APK is proven.

## DO NOT

- Do not run a blind `supabase db push`.
- Do not mass-delete Edge Functions.
- Do not rewrite migration timestamps already represented in staging.
- Do not cut the fleet over to Cloudflare.
- Do not merge PR #338 as a monolith.
- Do not merge PR #341.
- Do not select an Android APK only because it has the highest version number.
- Do not use Stripe LIVE.
- Do not expose or invoke a hardware mutation through a diagnostic or public
  rescue endpoint.
- Do not treat a GitHub Actions result with `runner_id=0` and `steps=[]` as a
  failed test suite; no runner executed the steps.
- Do not infer runtime provenance from matching names alone.

## Target end state

These are targets, not current achievements:

- `ONE_CANONICAL_REPO` — selected, but historical repositories still require
  evidence-based archival review.
- `ONE_MAINLINE` — selected, but staging-only work remains to be recovered.
- `ONE_STAGING_ARCHITECTURE` — decision recorded; deployment provenance remains
  unresolved.
- `ONE_PRODUCTION_ARCHITECTURE_DEFINED` — not achieved.
- `ONE_CANONICAL_MIGRATION_HISTORY` — not achieved.
- `ONE_CANONICAL_EDGE_FUNCTION_SOURCE_SET` — not achieved.
- `ONE_CANONICAL_ANDROID_STAGING_LINE` — not achieved.
- `ONE_REPRODUCIBLE_FRONTEND_DEPLOYMENT` — not achieved.
- `NO_UNKNOWN_DEPLOYMENT_PATH` — not achieved.
- `NO_UNEXPLAINED_PUBLIC_PRIVILEGED_ENDPOINT` — not achieved.
- `DOCUMENTATION_MATCHES_RUNTIME` — this documentation PR establishes the
  baseline; continuing verification is required.
- `STAGING_REPRODUCIBLE` — not achieved.

## Evidence precedence

When two sources disagree, record both. Prefer direct runtime or field evidence
for the statement "what is running", and reviewed Git source for the statement
"what should be built". Resolve the divergence in a dedicated, reviewed PR;
never silently promote one side into the other.

## Open evidence register

The following statements remain unresolved and must retain `UNKNOWN` until the
named evidence is collected:

| Unknown fact | Required evidence |
|---|---|
| Vercel owner, team, project and exact deployment source SHA | Access to the active project/deployment metadata plus artifact-to-commit manifest |
| Whether historical Vercel scopes/projects are still required | Owner/account inventory and deployment/DNS dependency check |
| Cloudflare account, Pages project, deployment SHA and effective settings | Read-only dashboard/API inventory for the active Pages domain |
| Clean local reconstruction of staging schema | Reconciled migrations replayed on a disposable database and semantic diff |
| Meaning of 143 staging-only and 35 Git-only migration versions | Version-by-version SQL/effect/checksum mapping |
| Resolution of duplicated Git migration timestamps | Historical filename, ordering, checksum and forward-only mapping |
| Exact source for 42 runtime-only Edge Functions | Runtime bundle/source recovery and reviewed Git representation |
| Effective authentication for each verify_jwt=false function | Function source, grants, headers/signatures/tokens, negative tests and logs |
| Complete callers for all 100 Edge Functions | Static call graph, function-to-function calls, frontend/Android search, Cron and external webhook inventories |
| Safe disposition of 30 temporary/diagnostic candidates | Dependency proof, sufficient no-use logs and retained rollback source |
| Installed Android package, versionCode, versionName, signer and APK hash on each station | Read-only ADB/package/APK inspection |
| Exact Android source commit for each installed APK | Reproducible artifact comparison and build manifest |
| Tablet model/Android OS and native reader mode per station | Read-only device inventory |
| DTA21277 physical Stripe reader identity/binding | Stripe TEST Terminal inventory plus on-device/reader verification |
| Effective hardware-ejection flag/bridge in each installed APK | Binary/config inspection; no mutation required |
| Latest controlled physical test linked to an immutable APK/source | Signed field-test report with station, slot, artifact and provider evidence |
| Stripe TEST account/project and webhook ownership mapping | Read-only Stripe environment/webhook inventory without secret values |
| ChargeNow callback registrations and active integration dependencies | Read-only provider configuration, logs and source mapping |
| Backup restorability | Restore rehearsal into an isolated environment |
| Unique change retained by each open PR/branch | Commit/file semantic diff against main, runtime and other retained PRs |
| Production frontend/backend/domain/payments/Android design | Separately reviewed production architecture and owner approval |

Repository branch/PR counts, runtime versions and station status are dated
snapshots. They require refresh at the start of the next authorized phase.
