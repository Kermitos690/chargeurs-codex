# Chargeurs.ch — Controlled Beta Execution Plan

Status: approved for implementation on 2026-07-15.

This runbook turns the architectural plan into ordered, auditable gates. It does not authorize production migrations, live payments or uncontrolled hardware movements.

## Gate 0 — Freeze and ownership

- [x] canonical repository and Project Bible identified;
- [x] PR #13 kiosk and beta safety merged into `main`;
- [x] integration branch created from current `main`;
- [ ] PR #4 settlement implementation ported onto the integration branch;
- [ ] PR #7 restricted to non-overlapping API foundations and read-only behavior;
- [ ] no new parallel payment, pricing, state-machine or ChargeNow implementation introduced.

Exit criterion: one branch owns settlement integration, one document defines the rules, and no competing runtime source of truth remains planned.

## Gate 1 — Settlement integration on current main

Required preservation:

- conditional BrowserRouter / HashRouter behavior;
- kiosk-only service worker;
- kiosk Error Boundary and blank-screen guard;
- station-bound `X-Kiosk-Token` transport;
- `beta_rentals_enabled=false` default;
- canonical price-profile rejection;
- current public and admin routes.

Required settlement behavior:

- card authorization/manual capture where eligible;
- TWINT or automatic-capture method prepayment with partial refund;
- final pricing from the server snapshot;
- non-return total of CHF 99;
- supplemental payment handling;
- retryable Stripe webhook inbox;
- settlement locks and abandoned-worker recovery;
- reconciliation after ChargeNow return.

Orchestrator rule:

- every critical state transition must pass through the canonical Rental Orchestrator transaction;
- legacy state fields may only be derived projections or be updated inside the same canonical transaction;
- no browser, webhook or hardware adapter may independently declare a rental completed.

Automated checks:

- [ ] `npm run lint`;
- [ ] `npm run typecheck`;
- [ ] `npm test`;
- [ ] `npm run build`;
- [ ] Deno checks for every changed Edge Function;
- [ ] settlement Deno tests;
- [ ] kiosk authentication contract tests;
- [ ] PostgreSQL orchestrator and beta-gate tests;
- [ ] no committed secrets;
- [ ] no unsafe browser redirect origin fallback;
- [ ] no raw public exception responses.

Exit criterion: integration branch CI is completely green and the PR remains draft pending staging.

## Gate 2 — Dedicated staging identity

Before any write:

- [ ] name and project reference of the non-production Supabase project recorded privately;
- [ ] confirmation that it is not the production or historical ambiguous project;
- [ ] Stripe key confirmed to be test mode;
- [ ] staging `PUBLIC_APP_URL` configured;
- [ ] ChargeNow test access scope confirmed;
- [ ] secrets present only in the environment, never in GitHub comments or artifacts;
- [ ] backup/export or rollback plan documented.

Exit criterion: all operators can identify exactly which environment will receive writes.

## Gate 3 — Migration dry-run and application

Expected migration families:

1. Rental Orchestrator storage;
2. kiosk beta release gate;
3. payment settlement strategy;
4. retryable Stripe webhook inbox;
5. any reviewed compatibility migration required by the integrated branch.

Process:

- [ ] generate ordered migration plan;
- [ ] run dry-run/read-only validation;
- [ ] review destructive operations and grants;
- [ ] verify RLS and `service_role` restrictions;
- [ ] apply migrations on staging only;
- [ ] record resulting migration versions;
- [ ] run database tests;
- [ ] confirm `beta_rentals_enabled=false` after application.

Exit criterion: schema matches the integration branch and all security assertions pass.

## Gate 4 — Edge Function deployment

Deploy only the reviewed integrated versions required for:

- payment creation/authorization;
- Stripe webhook handling;
- settlement worker/action;
- ChargeNow callback handling;
- station synchronization;
- rental admin reconciliation where required.

Checks:

- [ ] function authentication mode documented;
- [ ] service-role-only routes reject public access;
- [ ] kiosk route accepts only a station-bound token;
- [ ] webhook signatures verified;
- [ ] error bodies contain stable public codes rather than raw exceptions;
- [ ] logs redact credentials and unnecessary provider payloads.

Exit criterion: deployed staging functions pass health and authorization tests without making a hardware mutation.

## Gate 5 — Stripe test matrix without hardware

### Cards

- [ ] authorize CHF 30;
- [ ] cancel an unused authorization;
- [ ] capture CHF 0.75;
- [ ] capture a multi-period amount;
- [ ] enforce the CHF 18 daily cap;
- [ ] handle a CHF 99 non-return total;
- [ ] handle a CHF 69 supplement path;
- [ ] handle required customer authentication/manual review.

### TWINT / automatic capture methods

- [ ] collect the initial amount in the available test setup;
- [ ] refund the unused balance;
- [ ] verify a zero or minimal final amount path;
- [ ] verify refund retry idempotence.

### Webhooks and concurrency

- [ ] same successful webhook delivered twice;
- [ ] failed webhook replayed;
- [ ] out-of-order events;
- [ ] two settlement workers competing;
- [ ] abandoned lock recovery;
- [ ] no duplicate capture, cancellation, refund or supplemental charge.

Exit criterion: local ledger and Stripe amounts reconcile for every scenario.

## Gate 6 — DTA21269 read-only hardware validation

- [ ] regenerate the kiosk token from the administration;
- [ ] provision the token only on DTA21269;
- [ ] keep `beta_rentals_enabled=false`;
- [ ] call station-bound `sync-cabinet-status`;
- [ ] confirm online state;
- [ ] confirm total, rentable and returnable slots;
- [ ] confirm battery identifiers;
- [ ] confirm fresh `last_sync_at` and kiosk `last_seen_at`;
- [ ] assign the canonical price profile explicitly;
- [ ] verify no payment or ejection command occurred.

Exit criterion: DTA21269 is freshly synchronized and financially unable to start a rental.

## Gate 7 — One controlled end-to-end rental

Approved sequence:

1. enable the beta gate for the controlled window;
2. open the DTA21269 kiosk;
3. create one rental with the canonical snapshot;
4. authorize/collect the initial CHF 30 test payment;
5. receive and persist the Stripe proof;
6. request one ChargeNow ejection;
7. record the exact battery and slot/trade reference;
8. confirm active rental state through the orchestrator;
9. return the same battery;
10. correlate the destination station and slot;
11. calculate the final price;
12. capture, cancel or refund exactly once;
13. reconcile local, Stripe and ChargeNow states;
14. close the rental;
15. disable the beta gate again;
16. attach sanitized evidence.

Failure scenarios to execute separately:

- payment authorized but no ejection;
- ejection response timeout;
- callback delivered twice;
- battery ejected without complete local transition;
- return without a unique rental match;
- network loss and recovery;
- browser closed after payment;
- kiosk reload/reboot during the flow.

Exit criterion: nominal and compensation paths leave no unexplained financial or hardware state.

## Gate 8 — Settlement merge

The settlement integration may be marked ready only when:

- [ ] every previous gate has evidence;
- [ ] independent code/security review completed;
- [ ] CI green on the final head;
- [ ] no unresolved review thread;
- [ ] no public write API introduced;
- [ ] rollback procedure documented;
- [ ] Project Bible reflects the final implementation.

## Gate 9 — Platform API decomposition

After settlement merge:

- [ ] create a small PR for API client/key foundations;
- [ ] create a small PR for read-only API routes and OpenAPI;
- [ ] create a small PR for outbound signed webhooks;
- [ ] remove or disable duplicate payment/settlement implementations;
- [ ] preserve all public write scopes as disabled;
- [ ] validate quotas, redaction and revocation on staging.

## Gate 10 — Android kiosk

After web and API integration:

- [ ] rebase the Android branch;
- [ ] rebuild the debug APK;
- [ ] install on one actual station tablet;
- [ ] test provisioning, reboot, network loss and watchdog;
- [ ] test restricted navigation and token storage;
- [ ] choose device-owner/MDM or documented OEM mechanism;
- [ ] produce a signed internal release only after physical validation.

## Gate 11 — Sequential three-station beta

Order:

1. DTA21269;
2. DTA21277;
3. DTA22032.

Recommended minimum before expanding from one station to the next:

- ten consecutive complete cycles;
- zero duplicate payments;
- zero duplicate ejections;
- zero incorrect refunds;
- every ejected battery linked to a rental;
- every return uniquely reconciled;
- incidents visible and actionable in administration;
- recovery proven after a network interruption.

## Stop conditions

Stop immediately and close the beta gate when any of the following occurs:

- ambiguous environment identity;
- non-canonical pricing;
- missing or invalid pricing snapshot;
- duplicate financial effect;
- battery cannot be uniquely identified;
- return cannot be uniquely correlated;
- orchestrator and legacy state disagree without a deterministic repair;
- ChargeNow command result is uncertain;
- Stripe and local ledger do not reconcile;
- public access reaches a service-role operation;
- a secret appears in a log, issue, artifact or client response.
