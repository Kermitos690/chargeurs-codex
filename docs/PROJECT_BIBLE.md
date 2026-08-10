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
- Settlement integration branch: `integration/settlement-main`

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
- billing increment: 30 minutes, therefore CHF 0.75 per increment;
- included minutes: 0;
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
- React Router
- TanStack Query
- shadcn/ui
- PWA-compatible frontend restricted to kiosk routes
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

## 5. Single authority for rental state

The Rental Orchestrator is the intended authority for every critical rental transition.

Canonical processing sequence:

```text
command or external event
→ persistent idempotent inbox
→ business validation
→ append_rental_orchestrator_event
→ atomic database commit
→ outbox / external effect
→ reconciliation
```

Rules:

- the frontend and kiosk may request actions but cannot set final states;
- Stripe webhooks and ChargeNow callbacks must first be recorded idempotently;
- no settlement or hardware function may directly create a competing final-state source;
- legacy `rental_sessions.state` updates must be migrated behind the canonical orchestrator facade or retained only as a derived compatibility projection;
- external effects must not happen before the local transaction commits;
- retries must use stable idempotency keys tied to the rental and operation.

The settlement integration work must explicitly remove or encapsulate direct state mutations that conflict with this rule.

## 6. Implemented foundations already merged into `main`

### PR #1 — Chargeurs.ch V2 refactor

Merged.

Includes public redesign, SEO/local pages, centralized public pricing, support and partner pages, proactive rental alerts, station health score and kiosk architecture documentation.

### PR #2 — Rental Orchestrator domain

Merged.

Includes the rental state machine, typed events, idempotence, compensation planning and reconciliation logic.

### PR #3 — Rental Orchestrator Supabase storage

Merged.

Includes transactional snapshots, immutable event journal, idempotent inbox, operational incidents, atomic PostgreSQL mutation and restricted server-side persistence.

### PR #9 — Canonical Project Bible

Merged.

Defines the active repository, business rules, architecture, workstream ownership and integration order.

### PR #11 — Lovable routing and kiosk service-worker scope

Merged and validated on the published Lovable origin.

Includes direct-route recovery, conditional BrowserRouter/HashRouter support and kiosk-only service-worker registration.

### PR #13 — Kiosk activation, ChargeNow health and beta release safety

Merged as commit `9a7926e07c872339dd667482dbb51d69728661d0`.

Includes:

- station-bound kiosk authentication for `sync-cabinet-status`;
- `X-Kiosk-Token` isolation to the required Edge Function;
- explicit kiosk recovery screen and React Error Boundary;
- browser-side refusal of the historical unsafe quote;
- migration `20260715170500_kiosk_beta_release_gate.sql`;
- `beta_rentals_enabled=false` by default;
- PostgreSQL refusal of non-canonical kiosk pricing;
- dedicated frontend, Deno and PostgreSQL CI gates.

Important: merge into `main` does not prove that the migration or Edge Function has been deployed to staging.

## 7. Active workstreams

### Settlement integration — PR #4 source, new integration branch

Source PR: #4 `feat/settlement-engine`.

Current integration branch: `integration/settlement-main`, created from the post-PR #13 `main`.

The settlement engine remains the canonical owner of:

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

The old PR #4 branch is not mergeable directly against current `main`. Its implementation must be ported onto the integration branch while preserving PR #11 and PR #13 protections.

It may not be merged before staging evidence exists.

### PR #7 — Platform API

Status: open draft, not merged.

The branch currently contains both useful API infrastructure and overlapping payment/return logic. It must not be merged as one monolithic unit.

Approved decomposition:

1. API client and security foundations:
   - hashed API keys;
   - scopes;
   - quotas;
   - revocation;
   - redacted logs.
2. Read-only Platform API:
   - health;
   - stations;
   - availability;
   - inventory;
   - pricing;
   - rental consultation;
   - OpenAPI.
3. Outbound webhooks:
   - signatures;
   - durable queue;
   - retry worker;
   - observability.

Payment authorization, capture, refund, non-return and ChargeNow settlement logic must not compete with the canonical settlement engine. Those parts must be removed, disabled or reduced to adapters invoking the canonical orchestrator/settlement service.

All public write scopes remain disabled.

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

The branch must be rebased only after the web, settlement and read-only API state is integrated.

## 8. Required integration order

The approved sequence is:

1. freeze non-essential feature expansion;
2. use `integration/settlement-main` as the only branch for porting PR #4 onto current `main`;
3. preserve PR #11 routing/service-worker protections and all PR #13 kiosk/beta protections;
4. make the Rental Orchestrator the single state authority;
5. run the full frontend, Deno and PostgreSQL CI suite;
6. create and formally identify a separate non-production Supabase staging project;
7. run the migration gate in dry-run mode;
8. apply the orchestrator, beta-gate and settlement migrations only after reviewing the ordered plan;
9. deploy settlement Edge Functions to staging;
10. validate Stripe card and TWINT scenarios without hardware;
11. validate DTA21269 synchronization in read-only mode with `beta_rentals_enabled=false`;
12. run one controlled end-to-end rental on DTA21269;
13. merge the settlement integration only after evidence and independent review;
14. split and rebase the read-only parts of PR #7 onto the integrated `main`;
15. merge Platform API foundations in small reviewed PRs;
16. rebase PR #6 and build the APK from the final integrated web/API state;
17. install the rebuilt APK on one test tablet;
18. complete the physical kiosk matrix before merging PR #6;
19. expand the beta sequentially to DTA21277 and DTA22032.

GitHub issues #5 and #8 track staging and coordination.

## 9. Current temporary domain rule

Until a custom domain is acquired, all test flows use:

`https://chargeurs-codex.lovable.app`

The domain must remain configurable through environment variables and Android provisioning.

Relevant environment value:

- `PUBLIC_APP_URL`: temporary Lovable origin in staging

`PUBLIC_APP_URL` must be explicitly configured for settlement environments. Browser-supplied origins must not become an unrestricted redirect authority.

Do not hard-code a future custom domain into payment, kiosk or API logic.

## 10. Security rules

- never commit Stripe, Supabase, ChargeNow, Android signing or notification secrets;
- never paste secret values into issues, PRs or chat screenshots;
- privileged rental mutations must remain server-side;
- direct browser writes to orchestrator state are forbidden;
- use idempotency for Stripe, supplier callbacks and rental commands;
- maintain immutable or append-only audit evidence for critical transitions;
- keep public Platform API write scopes disabled until the staging gate passes;
- do not label any APK production-ready before release signing and physical validation;
- do not run production database migrations from an unreviewed feature branch;
- keep `beta_rentals_enabled=false` until the approved staging and hardware gates pass;
- do not return raw exception strings, provider payloads or secret names to public clients;
- do not use an unvalidated browser origin for Stripe success/cancel redirects;
- keep kiosk tokens scoped to the minimum required endpoint and station.

## 11. Status vocabulary

Every project report must use these meanings:

- Developed: code exists in a branch or `main`.
- Tested: automated or manual test evidence exists.
- Connected: code has been exercised against the real target service in the named environment.
- Validated: expected results were checked and evidence recorded.
- Mocked: behavior is simulated and must never be described as connected.
- Documented: architecture or behavior is described but not necessarily implemented.

A green CI proves repository quality checks. It does not prove Stripe, Supabase or ChargeNow staging connectivity.

## 12. Current blockers before a real beta

- the connected Supabase database has not been proven to be the dedicated non-production staging project;
- recent orchestrator, beta-gate and settlement migrations are not proven applied there;
- settlement Edge Functions are not proven deployed there;
- PR #4 has not yet been ported onto current `main`;
- direct legacy state mutation must be reconciled with the Rental Orchestrator;
- card authorization and partial capture have not been executed in Stripe test against the integrated code;
- TWINT collection and partial refund have not been executed in Stripe test against the integrated code;
- successful and failed Stripe events have not been replayed against the integrated staging state;
- one controlled ChargeNow ejection and return has not been validated;
- exact battery and slot correlation has not been proven end to end;
- DTA21269 requires a regenerated kiosk token and a fresh read-only synchronization;
- DTA21277 and DTA22032 require later sequential validation;
- PR #7 remains oversized and overlapping;
- the Android APK has not been rebuilt from the integrated state or installed on the real tablet;
- security and operational review remain incomplete.

## 13. Controlled beta release criteria

Before enabling kiosk rentals for a station, all of the following must be true:

- canonical migrations applied on the named staging project;
- required Edge Functions deployed;
- `PUBLIC_APP_URL` and test-only payment configuration verified;
- canonical price profile explicitly assigned;
- kiosk token regenerated and station-bound;
- ChargeNow read-only synchronization successful;
- card authorization/capture tests successful;
- TWINT collection/refund tests successful when available in the test setup;
- duplicate webhooks produce no duplicate financial effect;
- settlement and event locks survive concurrent processing;
- ejection identifies the exact battery;
- return identifies the exact battery and destination slot;
- local, Stripe and ChargeNow states reconcile;
- admin incident handling is available;
- `beta_rentals_enabled` is enabled only for the controlled test window.

## 14. Rules for future work

Any new Chargeurs.ch development must:

1. start from the latest approved integration base;
2. reference issue #8 while parallel integration remains open;
3. declare the files and business domain it owns;
4. avoid recreating Stripe, ChargeNow, pricing or orchestrator logic already owned elsewhere;
5. include tests and honest connection status;
6. update this Bible when architecture, business rules, active domain or integration order changes;
7. prefer a small, reviewable PR over a monolithic cross-domain branch;
8. keep all beta and production effects fail-closed by default.

No ChatGPT discussion, Codex session or Lovable prompt may independently redefine the project without first updating the canonical repository documentation.
