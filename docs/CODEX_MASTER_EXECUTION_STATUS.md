# Chargeurs.ch — master execution status

## Initial state

- Branch: `agent/finalize-chargeurs-platform`
- Initial HEAD: `16b56e0cef930d92790877bc4064f22f3339510f`
- Working tree: clean
- Audit source: `Chargeurs_CH_Audit_ChargeNow_2026-07-31_V2.zip` (local, sanitized)
- Environment safety defaults: ChargeNow mutations disabled; Stripe test only; hardware ejection disabled.

## Active phase

P4 — activation kiosk staging déployée ; preuve Android CI et baseline de migrations en cours.

## Completed before this master execution

- Existing staging hardening, kiosk pairing renewal, DTA reconciliation and Android lint fixes are present in the branch history.
- ChargeNow audit V2 has been reviewed as an independent functional reference, not vendor backend evidence.
- Frontend targeted role/state tests: 14 passed.
- Deno kiosk enrollment and security tests: 9 passed.
- Full Deno Edge Function contract suite: 174 passed.
- Typecheck and production frontend build: passed.
- The Deno test scripts now declare `--allow-read`; source-inspection kiosk tests had been blocked only by the missing local test permission.
- Station detail now exposes station-first kiosk attribution using the existing, hashed, one-time, organization-bound pairing-code backend. It shows existing kiosks and supports administrative revocation; it does not create a provider or hardware mutation.
- The primary activation format is now exactly six numeric digits, including a leading zero. The Android provisioning screen now uses a dedicated touch keypad instead of an alphanumeric field; QR remains optional in the admin UI.
- A new additive migration adds a server-side attempt ledger, 10-minute device/station/source limits, progressive delay, and no-plaintext-code storage.
- Java 17 was found locally at Homebrew's `openjdk@17`; Gradle now starts successfully with it.
- The diagnostic Android GitHub workflow is manual-only; an Android source push no longer starts a paid hosted build automatically.
- The additive numeric-enrollment migration was applied directly to the dedicated staging project after source review because `db push` remains blocked by unrelated historical drift. It created only a private attempt ledger, indexes, additive columns and overloaded server-only redemption functions.
- Staging `kiosk-admin` and `kiosk-enroll` are deployed at function version 13. An intentionally malformed enrollment request returns controlled HTTP 400 / `INVALID_ENROLLMENT_REQUEST`; it neither generated nor consumed a code.
- Vercel staging was deployed successfully. `/`, `/admin`, `/kiosk/DTA21269` and the PWA manifest respond through `https://chargeurs-ch-staging.vercel.app`; see `docs/DEPLOYMENT_REPORT.md`.

## Current work

- Reconcile local and remote Supabase migration histories into a reproducible baseline before using `db push` again; the observed plan is in `docs/SUPABASE_MIGRATION_RECONCILIATION.md`.
- Verify the current manual Android GitHub artifact workflow and archive its build evidence when it completes.
- React Router 7.18.1 has passed typecheck, the 68 frontend tests and the Vite build. Its remaining npm advisories concern React Server Components, a mode not used by this SPA; the exception is recorded in `docs/SECURITY_REPORT.md`.

## Blockers

- Staging Supabase CLI access is confirmed for `xqepbqnaenoeyfjkjnzl`, but local and remote migration histories diverge: remote-only migrations `20260725042947`–`20260725050549` and `20260731055742`–`20260731055745`, plus local-only migrations `20260720003000`, `20260724060000`, `20260724061000` and the new numeric-enrollment migration. No migration-history repair or remote write was attempted.
- Provider mutations, Stripe live and physical hardware operations are explicitly disabled.
- Android SDK Platform 36 and Build Tools 36 require acceptance of the Android SDK licence. The licence was displayed and deliberately not accepted automatically.

## Tests and deployments

- Staging Supabase: additive kiosk migration applied directly; `kiosk-admin` and `kiosk-enroll` deployed. No production deployment, provider mutation, Stripe live action, hardware command or code redemption occurred.
- Vercel staging deployment is READY. Local evidence is recorded in `docs/DEPLOYMENT_REPORT.md`, `docs/TEST_REPORT.md` and `docs/SECURITY_REPORT.md`.
- Existing lint command passes with 13 pre-existing warnings; strict zero-warning lint remains a technical-debt item outside this focused change.
- The Java-runtime blocker is resolved. Local SDK 36 remains unavailable because its licence was not accepted automatically, but the manual GitHub Android workflow succeeded on `b59b6b8` and produced an uninstalled staging debug APK. A follow-up manual workflow adds `apksigner verify` as build evidence.
- The former React Router 6 moderate advisories are removed by the 7.18.1 upgrade. npm still flags two React Server Components advisories; there is no RSC server, route module or import in the deployed SPA, but this must be reassessed before any future RSC adoption.

## Next operation

Collect the manual Android CI result, then commit the migration reconciliation evidence. Keep all supplier mutation flags disabled.
