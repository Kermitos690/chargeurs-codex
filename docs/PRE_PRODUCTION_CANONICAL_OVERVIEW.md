# Chargeurs.ch — canonical pre-production overview

Status date: 2026-08-27. This is the current operations and contract reference. Dated incident reports, old README revisions and `docs/PROJECT_BIBLE.md` remain historical evidence, not current monetary policy.

## Environments and safety boundaries

| Area | Staging | Production |
| --- | --- | --- |
| Supabase | `xqepbqnaenoeyfjkjnzl` (`chargeurs-ch-staging`) | Not changed by this branch |
| Stripe | `STRIPE_MODE=test`, `STRIPE_LIVE_ENABLED=false`; test keys only | Blocked pending separate approved live-runtime design |
| Hardware / ChargeNow | Read-only/simulation-safe validation unless a separately approved physical test is run | Blocked pending field and contract approvals |
| Wallet / PassStudio | Manual pass issue may be an explicit user action; automatic instance sync and billed push are disabled | Paid automatic provider operations remain blocked |
| Hosting | Staging/preview build only | Commercial plan/ownership verification required before use |

## Approved pilot pricing v3

The commercial pricing decision is fixed.

A read-only verification on 2026-08-27 shows that the staging database already reflects the intended final member v3 profile and contains the prepaid authorization/settlement primitives. The authoritative member pricing vectors checked through `compute_customer_pricing_snapshot` produced zero mismatches.

However, `supabase_migrations.schema_migrations` does **not** record `20260827010000`, `20260827020000` or `20260827030000`. The database therefore has migration-ledger drift: the state resembles the intended migrations, but it must not be described as a clean migration application and no blind `supabase db push` should be run until that history is reconciled. This database state also does not prove that the matching Edge runtime is deployed at the branch HEAD or that a physical end-to-end rental has passed.

### Express / guest

- 1.90 CHF up to 30 minutes;
- 3.90 CHF up to 2 hours;
- 5.90 CHF up to 6 hours;
- 7.90 CHF up to 24 hours;
- 7.90 CHF per additional started 24-hour continuation period;
- Stripe guarantee reference: 30 CHF.

### Member with prepaid Chargeurs.ch balance

- **2.00 CHF through 2 hours**;
- after 2 hours, **+1.00 CHF per started additional hour**;
- **5.90 CHF maximum per started 24-hour period**.

The authoritative first-day boundaries are: 0–120 minutes = 2.00 CHF; 121–180 = 3.00 CHF; 181–240 = 4.00 CHF; 241–300 = 5.00 CHF; from 301 minutes through 24 hours = 5.90 CHF. The daily cap then scales by started 24-hour period until the non-return rule applies.

For a v3 member rental with at least 30 CHF available in the server-side balance, the approved rail is `membership_prepaid`:

1. the member pairing selects the member snapshot;
2. the customer accepts the current contract/privacy versions;
3. the server claims `membership_prepaid` under the existing first-rail-wins lock;
4. exactly 30 CHF are reserved atomically in the internal ledger;
5. the Rental Orchestrator records the financial authorization;
6. no Stripe PaymentIntent is required for that internal reservation;
7. the hardware gate remains separate and still requires its own qualification;
8. at a normal return, the v3 price is committed from the reserved balance and the unused part is released.

If fewer than 30 CHF are available, no partial balance reservation is retained and the customer falls back to the full Stripe-guarantee path or later recharges the account. The pilot does not combine a partial internal balance with a partial Stripe guarantee.

### Recharges

The current staging ledger contains membership grants and rental reservation/settlement primitives, but a production-ready paid top-up journey still requires separate end-to-end validation. Future 20/50/100/200 CHF recharges may credit the ledger only after a trusted Stripe payment confirmation. A browser success page is not sufficient evidence to mint balance.

### Non-return

For new `pricing_rules_version=3` rentals, no confirmed return at 72 hours means a **30 CHF contractual total**, not “duration price + 30 CHF penalty”. v1/v2 snapshots remain immutable and retain their historical settlement semantics.

The v3 calculation is versioned, but automatic declaration/collection of a non-return remains blocked until the operator approves the exact operational/legal procedure. This avoids turning a pricing rule into an automatic financial action without final legal review.

## Runtime and operations

The rental snapshot is computed server-side and stored with every session. It contains the price period, daily cap, guarantee, non-return amount, rules version and hash. Settlement rejects a missing or modified snapshot. A rental becomes active only after server-confirmed financial coverage and physical release evidence.

The final member profile is technically encoded as `initial_fee_cents=100`, `included_minutes=60`, `period_minutes=60`, `price_per_period_cents=100`, `min_amount_cents=200`, `daily_cap_cents=590`. This representation is implementation detail; the customer-facing rule is the simpler “2 CHF jusqu'à 2 h, puis +1 CHF par heure commencée, max 5.90 CHF/24 h”.

The prepaid rail reuses the existing immutable membership-credit ledger and its idempotent reservation/commit/reversal RPCs. The v3 DB contract extends the payment-rail lock with `membership_prepaid`; it does not reinterpret an old Stripe rail as wallet money.

The three fixed staging Edge crons run every five minutes: rental email outbox, membership email outbox and `noop` customer-notification dispatcher (25,920 invocations/month together). Other currently active scheduled jobs are database-local. See `pre-production-zero-cost-budget-2026-08-26.md`.

Raw advertising impressions are aggregated before deletion after 14 days. Financial, rental lifecycle, contract and reconciliation evidence are excluded from that retention process.

## Customer contract and payment path

The kiosk records an explicit, unchecked acceptance of the current terms and privacy versions before financial commitment. If the member rail is unavailable, QR Checkout or Terminal still require the current acceptance. Values displayed at acceptance must come from the immutable server pricing snapshot.

The current public legal routes are:

- `/legal/conditions`
- `/legal/confidentialite`
- `/legal/mentions-legales`

The product pricing decision is defined above, but public legal identity, postal address and final human Swiss legal/accounting review remain pending.

## Paid external operations

Stripe payment creation, ChargeNow release commands, Resend sends and PassStudio issuance/pushes are external operations. Tests and staging checks must not call them unless an explicitly approved test procedure applies. Automatic PassStudio push/sync is disabled; automatic Resend remains fail-closed when unconfigured.

`membership_prepaid` itself performs no Stripe operation: it reserves already-existing internal credit. Hardware release remains a separate post-authorization operation with its own safety gate.

## Validation path

The branch contains `.github/workflows/pre-production-v3-financial-ci.yml`, a safe PR/manual workflow that uses no project secrets, performs no Supabase write, makes no Stripe call and sends no hardware command. It runs TypeScript checking, focused Vitest contracts for v3/prepaid/legal/hardening, pure Deno pricing/hardening contracts and the web build including kiosk prebuild guardrails. The exact equivalent local commands are documented in `TESTING.md`.

Database contract tests and any staging E2E remain separate because they require an explicitly controlled non-production database/runtime. A green repository CI is not a substitute for migration-history reconciliation or physical/payment proof.

## Documentation map

| Document | Public route / role | Current status |
| --- | --- | --- |
| `src/pages/LegalPage.tsx` | Legal terms, privacy, legal notice | Pre-production text; company identity and final legal approval pending |
| `src/pages/PaymentChoice.tsx` | Customer web payment acceptance | Must display the immutable v3 pricing snapshot accurately |
| `src/pages/Kiosk.tsx` | Kiosk contract review and transactional journey | Uses server snapshot and polls canonical rental state |
| `PRICING_ENGINE.md` | Approved pilot pricing v3 and versioning semantics | Canonical engineering pricing reference |
| `STRIPE_PAYMENT_MODEL.md` | Stripe + internal prepaid financial rails | Canonical engineering payment reference |
| `TESTING.md` | Exact safe local/CI validation commands | Current testing reference |
| `docs/pre-production-runtime-manifest-2026-08-26.md` | Staging runtime inventory | Historical runtime evidence; re-check before deployment |
| `docs/pre-production-zero-cost-budget-2026-08-26.md` | Staging quota model | Current staging cron evidence |

## Current blockers before commercial production

- reconcile the staging migration ledger for v3/prepaid before any migration push;
- matching Edge runtime deployment and controlled end-to-end validation of v3 + prepaid + acceptance code;
- paid top-up flow end-to-end validation;
- legal entity/postal address and human Swiss consumer/privacy/accounting review;
- explicit decision on automatic non-return declaration/collection;
- Vercel commercial owner/plan verification;
- separate Stripe LIVE runtime approval;
- physical E2E proof on each enabled station;
- backup/restore operational proof;
- ChargeNow callback-secret rotation if historical URL logging exposure is confirmed.

## Do not treat as production approval

This branch is still **NO-GO for production**. The approved pricing is no longer a decision blocker, and the current staging calculators can be checked read-only, but migration-history, Edge-runtime, top-up, legal, hosting, live-payment and physical-field gates remain.
