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

The commercial pricing decision is fixed in this branch. It is **not yet activated on staging**: the v3 pricing migration, prepaid-rail migration and matching Edge code must be deployed and validated together.

### Express / guest

- 1.90 CHF up to 30 minutes;
- 3.90 CHF up to 2 hours;
- 5.90 CHF up to 6 hours;
- 7.90 CHF up to 24 hours;
- 7.90 CHF per additional started 24-hour continuation period;
- Stripe guarantee reference: 30 CHF.

### Member with prepaid Chargeurs.ch balance

- 1.00 CHF covers the first 30 minutes;
- +0.40 CHF per additional started 30-minute period;
- 5.90 CHF maximum per 24-hour period.

For a v3 member rental with at least 30 CHF available in the server-side balance, the approved rail is now versioned in the branch as `membership_prepaid`:

1. the member pairing selects the member snapshot;
2. the customer accepts the current contract/privacy versions;
3. the server claims `membership_prepaid` under the existing first-rail-wins lock;
4. exactly 30 CHF are reserved atomically in the internal ledger;
5. the Rental Orchestrator records `payment_started` then `payment_authorized`;
6. the rental receives `settlement_status=prepaid` without creating a Stripe PaymentIntent;
7. the existing hardware gate still requires the canonical authorized state and physical qualification;
8. at a normal return, the v3 price is committed from the reserved balance and the unused part is released.

If fewer than 30 CHF are available, no partial balance reservation is retained and the customer falls back to the full Stripe-guarantee path (or later recharges the account). The pilot does not combine a partial internal balance with a partial Stripe guarantee.

### Recharges

The current staging ledger contains membership grants and rental reservation/settlement entries, but **does not yet contain a production-ready paid top-up entry type or Stripe top-up flow**. Future 20/50/100/200 CHF recharges must be implemented as a separate server-owned payment flow and may credit the ledger only after a trusted Stripe payment confirmation. A browser success page is not sufficient evidence to mint balance.

### Non-return

For new `pricing_rules_version=3` rentals, no confirmed return at 72 hours means a **30 CHF contractual total**, not “duration price + 30 CHF penalty”. v1/v2 snapshots remain immutable and retain their historical settlement semantics.

The v3 calculation is versioned, but automatic declaration/collection of a non-return remains disabled until the operator approves the exact operational/legal procedure. This avoids turning a pricing rule into an automatic financial action without final legal review.

## Runtime and operations

The rental snapshot is computed server-side and stored with every session. It contains the price period, daily cap, guarantee, non-return amount, rules version and hash. Settlement rejects a missing or modified snapshot. A rental becomes active only after server-confirmed financial coverage and physical release evidence.

The prepaid rail reuses the existing immutable membership-credit ledger and its idempotent reservation/commit/reversal RPCs. The new v3 DB contract extends the payment-rail lock with `membership_prepaid`; it does not reinterpret an old Stripe rail as wallet money.

The three fixed staging Edge crons run every five minutes: rental email outbox, membership email outbox and `noop` customer-notification dispatcher (25,920 invocations/month together). Other currently active scheduled jobs are database-local. See `pre-production-zero-cost-budget-2026-08-26.md`.

Raw advertising impressions are aggregated before deletion after 14 days. Financial, rental lifecycle, contract and reconciliation evidence are excluded from that retention process.

## Customer contract and payment path

The kiosk records an explicit, unchecked acceptance of the current terms and privacy versions before financial commitment. The same acceptance endpoint may select `membership_prepaid` only after the acceptance has been persisted. If the member rail is unavailable, QR Checkout or Terminal still require the current acceptance.

The current public legal routes are:

- `/legal/conditions`
- `/legal/confidentialite`
- `/legal/mentions-legales`

The product pricing decision is defined above, but public legal identity, postal address and final human Swiss legal/accounting review remain pending. Values displayed at acceptance must come from the immutable server pricing snapshot.

## Paid external operations

Stripe payment creation, ChargeNow release commands, Resend sends and PassStudio issuance/pushes are external operations. Tests and staging checks must not call them unless an explicitly approved test procedure applies. Automatic PassStudio push/sync is disabled; automatic Resend remains fail-closed when unconfigured.

`membership_prepaid` itself performs no Stripe operation: it reserves already-existing internal credit. Hardware release remains a separate post-authorization operation with its own safety gate.

## Documentation map

| Document | Public route / role | Current status |
| --- | --- | --- |
| `src/pages/LegalPage.tsx` | Legal terms, privacy, legal notice | Pre-production text; company identity and final legal approval pending |
| `src/pages/PaymentChoice.tsx` | Customer web Stripe payment acceptance | Canonical mobile/web Stripe acceptance UI |
| `src/pages/Kiosk.tsx` | Kiosk contract review and transactional journey | Uses server snapshot and polls canonical rental state |
| `PRICING_ENGINE.md` | Approved pilot pricing v3 and versioning semantics | Canonical engineering pricing reference |
| `STRIPE_PAYMENT_MODEL.md` | Stripe + internal prepaid financial rails | Canonical engineering payment reference |
| `docs/pre-production-runtime-manifest-2026-08-26.md` | Staging runtime inventory | Current hardening evidence |
| `docs/pre-production-zero-cost-budget-2026-08-26.md` | Staging quota model | Current staging cron evidence |

## Current blockers before commercial production

- coordinated staging deployment/validation of pricing v3 + prepaid rail + acceptance code;
- real top-up flow is not yet implemented;
- legal entity/postal address and human Swiss consumer/privacy/accounting review;
- explicit decision on automatic non-return declaration/collection;
- Vercel commercial owner/plan verification;
- separate Stripe LIVE runtime approval;
- physical E2E proof on each enabled station;
- backup/restore operational proof;
- ChargeNow callback-secret rotation if historical URL logging exposure is confirmed.

## Do not treat as production approval

This branch is still **NO-GO for production**. The approved pricing is no longer a decision blocker, but deployment, prepaid top-up, legal, hosting, live-payment and physical-field gates remain.