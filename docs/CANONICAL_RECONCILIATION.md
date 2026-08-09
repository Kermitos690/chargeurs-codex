# Canonical reconciliation

## RC base

- Base chosen: `agent/finalize-chargeurs-platform` at `9faf10211f813bb638f2bdb9d46e737abfed2567`.
- QR/kiosk source: `codex/staging-qr-i18n` at `757a6009fba7d0e819e6f8cfef07cfab41677198`.
- RC branch: `codex/field-deployment-v1`.
- Reconciliation commit: `ab38044c417ef689f25c9307bcbc75802398e4bd`.

## Decision

The complete `3825f5b..757a600` QR, CORS, i18n, inventory, diagnostic and Stripe
checkout range was merged cleanly into the platform base. No source commit was
silently dropped. The resulting branch keeps the ChargeNow normalization and
hardware safeguards from the platform base as well as the recent kiosk work.

## Remaining divergence risk

`main` is not the RC base. PR #36 and #46 must not be treated as proof of a
staging deployment. The linked Supabase project has migrations that are absent
from this repository and this repository has migrations not listed as applied
on staging. Reconcile that drift before deploying any Edge Function that calls
the new reservation RPC.

## Status

IMPLEMENTED: branch reconciliation.  
AUTOMATED_TESTED: merge and source tests only.  
DEPLOYED_STAGING: no.  
FIELD_READY: no.
