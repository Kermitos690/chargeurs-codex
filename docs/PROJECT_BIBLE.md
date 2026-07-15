# Chargeurs.ch — Project Bible

Status date: 2026-07-15

This document is the canonical operational source for the Chargeurs.ch project. It supersedes descriptions, prompts, screenshots and architectural assumptions from older ChatGPT discussions, legacy Lovable projects and abandoned prototypes.

## 1. Canonical source of truth

- GitHub repository: `Kermitos690/chargeurs-codex`
- Main branch: `main`
- Active Lovable project: `chargeurs-codex`
- Lovable project ID: `d69d56c9-f676-4445-8574-f8a3151cf9ae`
- Temporary published origin: `https://chargeurs-codex.lovable.app`
- Human decision log: the dedicated central ChatGPT conversation chosen by the project owner

No older ChatGPT discussion or legacy Lovable project may be treated as authoritative unless its information is explicitly incorporated into this document or the repository.

## 2. Legacy projects that are not release sources

The following names may contain historical prototypes, prompts or designs, but are not the active release source:

- `chargeurs`
- `chargeurs-ch`
- `chargeurs-network`
- `chargeurs-power-flow`
- `chargeurs-power-flow-08`
- `chargeurs-power-app`
- `chargeurs-power-go`
- `chargeurs-power-up-app`
- `lovable-power-rentals-app`
- `charge-on-the-go-56`
- other earlier Chargeurs.ch or powerbank prototypes

Do not copy code, configuration, secrets or deployment assumptions from those projects without an explicit review against the current repository.

## 3. Confirmed business rules

The currently retained commercial rules are:

- customer starts a rental from a QR code displayed on the kiosk;
- no physical Wisepad payment terminal is required for the retained test architecture;
- initial payment basis: CHF 30;
- hourly rate: CHF 1.50;
- billing increment: 30 minutes;
- daily cap: CHF 18;
- non-return total: CHF 99;
- the non-return amount is composed of the initial CHF 30 basis plus a possible CHF 69 supplement;
- when the final amount is below CHF 30, only the final amount must remain charged;
- a battery confirmed as returned can close the rental and trigger final settlement;
- a battery leaving the Chargeurs.ch ecosystem and not returned is treated as acquired under the non-return rule;
- pricing values must come from the server-side pricing snapshot, never from the browser;
- a return in another compatible station is part of the intended business model, but must rely on exact ChargeNow battery/slot correlation before it can be certified.

Any future change to these rules must be recorded here before code is merged.

## 4. Retained architecture

### Web application

- Vite
- React
- TypeScript
- shadcn/ui
- PWA-compatible frontend
- public pages, kiosk routes, customer account and administration in one repository

### Backend

- Supabase PostgreSQL
- Supabase Auth
- Supabase Edge Functions using Deno
- server-side `service_role` for privileged rental mutations
- Row-Level Security for database boundaries

### Payments

- Stripe Checkout and PaymentIntent-based flows
- card strategy: authorization/manual capture when eligible
- TWINT strategy: automatic collection followed by refund of the unused balance
- Stripe webhooks as the payment source of truth

### Hardware supplier

- ChargeNow supplier API and callbacks
- server-side ejection/return handling
- no browser-authoritative hardware state

### Android kiosk

- native Android wrapper around the kiosk web application
- station-specific provisioning
- kiosk token stored with Android Keystore
- temporary origin configurable and currently defaulted to `https://chargeurs-codex.lovable.app`

### Platform API

- versioned read-first API under `/v1`
- API clients and hashed API keys
- scopes, quotas and redacted request logs
- payment and hardware public write commands remain disabled until staging validation

## 5. Implemented foundations already merged into `main`

### PR #1 — Chargeurs.ch V2 refactor

Merged.

Includes public redesign, SEO/local pages, centralized public pricing, support and partner pages, proactive rental alerts, station health score and kiosk architecture documentation.

### PR #2 — Rental Orchestrator domain

Merged.

Includes the rental state machine, typed events, idempotence, compensation planning and reconciliation logic.

### PR #3 — Rental Orchestrator Supabase storage

Merged.

Includes transactional snapshots, immutable event journal, idempotent inbox, operational incidents, atomic PostgreSQL mutation and restricted server-side persistence.

These merged foundations do not by themselves prove deployment to staging or successful operation with real Stripe and ChargeNow services.

## 6. Active workstreams

### PR #4 — Payment settlement engine

Status: open draft, not merged.

Owns:

- card authorization and final capture;
- TWINT prepayment and partial refund;
- final amount calculation;
- non-return settlement up to CHF 99;
- supplemental payment handling;
- retryable Stripe webhook inbox;
- settlement locks and abandoned-worker recovery;
- ChargeNow return-triggered settlement;
- financial reconciliation and admin actions;
- settlement migrations;
- frontend lazy loading and bundle splitting.

Validated in CI, but not yet certified on Supabase staging, Stripe test and physical ChargeNow hardware.

### PR #7 — Platform API v1

Status: open draft, not merged.

Owns:

- versioned read-first API;
- API clients;
- hashed API keys;
- scopes and quotas;
- redacted request logs;
- health, station, availability, inventory, pricing and rental read routes;
- OpenAPI documentation;
- super-admin API client interface.

Payment, rental and hardware public write commands remain disabled.

Known overlap with PR #4: `src/App.tsx`.

Required integration rule: preserve PR #4 lazy loading and add the PR #7 API client route and navigation entry.

### PR #6 — Android kiosk wrapper

Status: open draft, not merged.

Owns:

- `android-kiosk/`;
- Android provisioning;
- encrypted kiosk token storage;
- WebView security restrictions;
- full-screen behavior;
- watchdog and network recovery;
- Android CI and debug APK artifact;
- Android documentation.

The debug APK is a test artifact. It is not a production-signed APK and is not yet certified on the actual station tablet hardware.

## 7. Required integration order

The only approved integration sequence is:

1. keep PR #4, #7 and #6 in draft;
2. validate PR #4 on a non-production Supabase project, Stripe test and one controlled ChargeNow station;
3. merge PR #4 after evidence and review;
4. rebase PR #7 onto the new `main`;
5. resolve `src/App.tsx` by retaining lazy loading and adding `/admin/api-clients`;
6. validate the Platform API in read-only mode on staging;
7. merge PR #7;
8. rebase PR #6 onto the integrated `main`;
9. rebuild the APK from the integrated web/API state;
10. install the rebuilt APK on one test tablet;
11. complete the physical kiosk test matrix before merging PR #6.

GitHub issue #8 tracks this coordination sequence.

## 8. Current temporary domain rule

Until a custom domain is acquired, all test flows use:

`https://chargeurs-codex.lovable.app`

The domain must remain configurable through environment variables and Android provisioning.

Relevant environment value:

- `PUBLIC_APP_URL`: temporary Lovable origin in staging

Do not hard-code a future custom domain into payment, kiosk or API logic.

## 9. Security rules

- never commit Stripe, Supabase, ChargeNow, Android signing or notification secrets;
- never paste secret values into issues, PRs or chat screenshots;
- privileged rental mutations must remain server-side;
- direct browser writes to orchestrator state are forbidden;
- use idempotency for Stripe, supplier callbacks and rental commands;
- maintain immutable or append-only audit evidence for critical transitions;
- keep public Platform API write scopes disabled until the staging gate passes;
- do not label any APK production-ready before release signing and physical validation;
- do not run production database migrations from an unreviewed feature branch.

## 10. Status vocabulary

Every project report must use these meanings:

- Developed: code exists in a branch or `main`.
- Tested: automated or manual test evidence exists.
- Connected: code has been exercised against the real target service in the named environment.
- Validated: expected results were checked and evidence recorded.
- Mocked: behavior is simulated and must never be described as connected.
- Documented: architecture or behavior is described but not necessarily implemented.

A green CI proves repository quality checks. It does not prove Stripe, Supabase or ChargeNow staging connectivity.

## 11. Current blockers before a real beta

- apply and validate settlement migrations on Supabase staging;
- deploy the relevant settlement Edge Functions to staging;
- execute card authorization and partial capture in Stripe test;
- execute TWINT collection and partial refund in Stripe test;
- replay success and failure webhooks without duplicate financial effects;
- validate one controlled ChargeNow ejection and return;
- prove exact battery and slot correlation;
- integrate and validate PR #7 after PR #4;
- rebuild and test the Android APK after the web/API integration;
- sign a release APK only after physical testing;
- complete security and operational review before production.

## 12. Rules for future work

Any new Chargeurs.ch development must:

1. start from the latest `main`;
2. reference GitHub issue #8 while parallel integration remains open;
3. declare the files and domain it owns;
4. avoid recreating Stripe, ChargeNow, pricing or orchestrator logic already owned elsewhere;
5. include tests and honest connection status;
6. update this Bible when architecture, business rules, active domain or integration order changes.

No ChatGPT discussion, Codex session or Lovable prompt may independently redefine the project without first updating the canonical repository documentation.