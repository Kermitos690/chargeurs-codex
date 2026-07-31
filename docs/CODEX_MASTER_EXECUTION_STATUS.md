# Chargeurs.ch — master execution status

## Initial state

- Branch: `agent/finalize-chargeurs-platform`
- Initial HEAD: `16b56e0cef930d92790877bc4064f22f3339510f`
- Working tree: clean
- Audit source: `Chargeurs_CH_Audit_ChargeNow_2026-07-31_V2.zip` (local, sanitized)
- Environment safety defaults: ChargeNow mutations disabled; Stripe test only; hardware ejection disabled.

## Active phase

P4 — staging kiosk activation deployed; frontend/Android delivery validation in progress.

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
- The diagnostic Android GitHub workflow is manual-only; an Android source push no longer starts a paid hosted build automatically.
- The additive numeric-enrollment migration was applied directly to the dedicated staging project after source review because `db push` remains blocked by unrelated historical drift. It created only a private attempt ledger, indexes, additive columns and overloaded server-only redemption functions.
- Staging `kiosk-admin` and `kiosk-enroll` are deployed at function version 13. An intentionally malformed enrollment request returns controlled HTTP 400 / `INVALID_ENROLLMENT_REQUEST`; it neither generated nor consumed a code.

## Current work

- Reconcile local and remote Supabase migration histories into a reproducible baseline before using `db push` again.
- Deploy the committed frontend to staging and verify the protected administrator path.
- Run Android validation after the Android SDK licence is explicitly accepted and SDK 36 installed, or use the manual GitHub artifact workflow.
- Upgrade React Router in a separate compatibility-tested commit to resolve the two production moderate advisories.

## Blockers

- Staging Supabase CLI access is confirmed for `xqepbqnaenoeyfjkjnzl`, but local and remote migration histories diverge: remote-only migrations `20260725042947`–`20260725050549` and `20260731055742`–`20260731055745`, plus local-only migrations `20260720003000`, `20260724060000`, `20260724061000` and the new numeric-enrollment migration. No migration-history repair or remote write was attempted.
- Provider mutations, Stripe live and physical hardware operations are explicitly disabled.
- Android SDK Platform 36 and Build Tools 36 require acceptance of the Android SDK licence. The licence was displayed and deliberately not accepted automatically.

## Tests and deployments

- Staging Supabase: additive kiosk migration applied directly; `kiosk-admin` and `kiosk-enroll` deployed. No production deployment, provider mutation, Stripe live action, hardware command or code redemption occurred.
- Existing lint command passes with 13 pre-existing warnings; strict zero-warning lint remains a technical-debt item outside this focused change.
- The Java-runtime blocker is resolved. The remaining Android blocker is the missing licensed Android SDK 36; no APK was built, installed or published.
- Production dependency audit reports two moderate React Router advisories. A compatibility trial of `react-router-dom@7.18.1` was reverted because the current audit then reported two high-severity RSC-mode advisories; no dependency lockfile change was retained.

## Next operation

Commit the manual-only Android CI cost control, then create a read-only reconciliation artefact for the Supabase migration drift before any staging deployment. Keep all supplier mutation flags disabled.
