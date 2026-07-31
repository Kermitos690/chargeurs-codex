# Chargeurs.ch — master execution status

## Initial state

- Branch: `agent/finalize-chargeurs-platform`
- Initial HEAD: `16b56e0cef930d92790877bc4064f22f3339510f`
- Working tree: clean
- Audit source: `Chargeurs_CH_Audit_ChargeNow_2026-07-31_V2.zip` (local, sanitized)
- Environment safety defaults: ChargeNow mutations disabled; Stripe test only; hardware ejection disabled.

## Active phase

P1/P3 — numeric kiosk activation implemented locally; staging migration baseline reconciliation pending.

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
- A new additive migration adds a server-side attempt ledger, 10-minute device/station/source limits, progressive delay, and no-plaintext-code storage. It has not been applied to staging while migration drift is reconciled.
- Java 17 was found locally at Homebrew's `openjdk@17`; Gradle now starts successfully with it.

## Current work

- Reconcile local and remote Supabase migration histories before applying the numeric enrollment migration.
- Run Android validation after the Android SDK licence is explicitly accepted and SDK 36 installed.
- Upgrade React Router in a separate compatibility-tested commit to resolve the two production moderate advisories.

## Blockers

- Staging Supabase CLI access is confirmed for `xqepbqnaenoeyfjkjnzl`, but local and remote migration histories diverge: remote-only migrations from 20260725/20260731 and local-only migrations from 20260720/20260724 must be baselined before a safe push.
- Provider mutations, Stripe live and physical hardware operations are explicitly disabled.
- Android SDK Platform 36 and Build Tools 36 require acceptance of the Android SDK licence. The licence was displayed and deliberately not accepted automatically.

## Tests and deployments

- No staging deployment or database migration has been run in this execution.
- Existing lint command passes with 13 pre-existing warnings; strict zero-warning lint remains a technical-debt item outside this focused change.
- The Java-runtime blocker is resolved. The remaining Android blocker is the missing licensed Android SDK 36; no APK was built, installed or published.
- Production dependency audit reports two moderate React Router advisories. A dependency upgrade is available but has not been applied automatically; it needs a dedicated compatibility pass.

## Next operation

Commit the focused six-digit kiosk change after the frontend suite/build, then reconcile Supabase migration drift before any staging deployment. Keep all supplier mutation flags disabled.
