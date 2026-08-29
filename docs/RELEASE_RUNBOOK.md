# Chargeurs.ch — Release Runbook Structure

Status date: **2026-08-29**

This is the structure of a future controlled release process. It contains no
production deployment command and grants no authorization to mutate staging,
production, Stripe or hardware.

## Release states

| State | Meaning |
|---|---|
| `BLOCKED` | One or more mandatory evidence items are absent. |
| `READY_FOR_STAGING_REVIEW` | Source artifacts are converged and reproducible, but nothing is authorized for production. |
| `STAGING_VALIDATED` | The approved staging test plan passed with linked evidence. |
| `PRODUCTION_GO_PENDING` | Production architecture exists and all technical gates passed; business owner approval remains required. |
| `PRODUCTION_GO` | A separate explicit approval identifies exact artifacts, environment and rollback plan. |

Default state: **`BLOCKED`**.

## Global release manifest

Every future release must record:

- release identifier and timestamp;
- approved source commit;
- web artifact hash and deployment ID;
- canonical migration-set identifier and schema comparison result;
- Edge Function names, versions and bundle hashes;
- Android APK filename, file SHA-256, signer SHA-256, `versionCode`,
  `versionName`, package and source commit;
- environment-specific project IDs without secret values;
- Stripe mode (`test` or `live`) and webhook endpoint ownership;
- station scope and approved hardware operations;
- backup identifier and restoration evidence;
- approvers, PASS/FAIL result and rollback trigger.

## Gate 1 — Source convergence

**Purpose:** prove that one reviewed commit owns the intended release.

Required evidence:

- repository is `Kermitos690/chargeurs-codex`;
- base is current protected `main` at review time;
- relevant PR changes have been selectively ported or explicitly rejected;
- documentation, source and dependency lock state are reviewed;
- CI jobs actually executed; pre-run `runner_id=0`, `steps=[]` records are not
  counted as test results.

PASS requires one immutable source SHA. Current status: `BLOCKED`.

## Gate 2 — DB/migration convergence

**Purpose:** prove that schema intent and environment ledger agree.

Required evidence:

- completed `docs/MIGRATION_RECONCILIATION.md` register;
- clean-room migration replay;
- schema/RLS/grant comparison;
- reviewed staging-only plan;
- backup and rollback approval before any write.

No blind database push is permitted. Current status: `BLOCKED`.

## Gate 3 — Edge Function convergence

**Purpose:** prove that every deployed function has reviewed source and known
authentication/callers.

Required evidence:

- one source directory for every function intended to remain active;
- runtime/source version or bundle-hash mapping;
- `verify_jwt` plus effective application authentication;
- cron, webhook, frontend, Android and operator dependencies;
- explicit retention/retirement verdict.

PASS requires no unexplained public privileged endpoint. Current status:
`BLOCKED`.

## Gate 4 — Web staging deployment

**Purpose:** deploy one reproducible web artifact to the canonical staging
frontend.

Required evidence:

- Vercel team/project ownership reconciled;
- one approved staging deployment workflow;
- source SHA embedded in or linked to deployment metadata;
- artifact hash, deployment ID, domain and rollback deployment captured;
- kiosk proxy-route contract tested against staging.

Cloudflare is excluded unless a later architecture decision replaces Vercel.
Current status: `BLOCKED`.

## Gate 5 — Android artifact provenance

**Purpose:** designate one safe staging APK line.

Required evidence:

- exact package, `versionCode`, `versionName`, SDK and feature flags;
- APK SHA-256 and signer SHA-256;
- exact source commit and reproducible build manifest;
- enrollment and WebView origins;
- Stripe Terminal SDK/reader mode;
- upgrade and rollback compatibility for each station.

No APK is selected by version number alone. Current status: `BLOCKED`.

## Gate 6 — Stripe TEST validation

**Purpose:** prove the financial lifecycle without LIVE funds.

Test scope must include:

- Checkout and supported PaymentIntent modes;
- verified webhook processing and idempotent replay;
- cancellation, expiry, capture, refund and failure paths;
- pricing snapshot immutability;
- Terminal TEST binding and reader behavior where applicable;
- reconciliation between Stripe objects and Supabase records.

A browser success redirect is never payment proof. Current status: `BLOCKED`.

## Gate 7 — ChargeNow integration

**Purpose:** prove provider authentication, idempotence, callback correlation
and read-back before hardware approval.

Start with read-only inventory/status evidence. Any mutative provider call
requires a separately approved test case, exact station/slot, rollback/incident
plan and operator presence. Current status: `BLOCKED`.

## Gate 8 — Controlled hardware validation

**Purpose:** correlate software intent with a single physical outcome.

Required evidence:

- approved station, slot, battery and rental/test identifier;
- pre-test inventory and device/APK provenance;
- one authorized operation with no duplicate release;
- provider callback/read-back and physical observation;
- return correlation and final inventory;
- incident stop conditions.

Diagnostic or public rescue endpoints may not perform hardware mutations.
Current status: `BLOCKED`.

## Gate 9 — Backup/restore validation

**Purpose:** prove recovery, not merely backup creation.

Required evidence:

- environment-scoped database backup;
- restore into an isolated target;
- integrity checks for critical tables, auth references, storage metadata and
  audit history;
- documented recovery time and responsible operator.

Current status: `BLOCKED`.

## Gate 10 — Production architecture

**Purpose:** define a production system fully separated from staging.

Required evidence:

- production frontend project, domain and owner;
- distinct production Supabase project and migration baseline;
- Stripe LIVE account/webhook/secrets separation;
- production Android package/signing/update policy;
- ChargeNow production scope and station onboarding process;
- monitoring, alerting, incident, privacy and retention plans;
- backup and restoration ownership.

No production architecture is currently configured. Current status: `NO-GO`.

## Gate 11 — Explicit production GO approval

**Purpose:** require a human decision bound to exact immutable artifacts.

The approval must name the release manifest, source SHA, migration set, function
set, web deployment, APK, stations, Stripe mode, rollback and responsible
operators. Silence, a merged PR or a successful staging deploy is not approval.

This gate may be signed only after Gates 1–10 PASS. Current status: `NO-GO`.

## Rollback principle

Every mutable release step must have a rehearsed rollback or safe-stop action
before execution. Hardware actions that cannot be reversed require an incident
containment plan rather than a fictional rollback.

## Current release verdict

Chargeurs.ch staging is observable but not yet reproducible from one canonical
source set. Production remains `NOT CONFIGURED` and `NO-GO`.
