# Chargeurs.ch — canonical pre-production overview

Status date: 2026-08-27. This is the current operations and contract reference;
dated incident reports and release notes remain historical evidence, not current
product policy.

## Environments and safety boundaries

| Area | Staging | Production |
| --- | --- | --- |
| Supabase | `xqepbqnaenoeyfjkjnzl` (`chargeurs-ch-staging`) | Not changed by this branch |
| Stripe | `STRIPE_MODE=test`, `STRIPE_LIVE_ENABLED=false`; test keys only | Blocked pending separate approved live-runtime design |
| Hardware / ChargeNow | Read-only and simulation-safe gates; no real rental in validation | Blocked pending field and contract approvals |
| Wallet / PassStudio | Manual pass issue may be an explicit user action; automatic instance sync and billed push are disabled | Paid automatic provider operations remain blocked |
| Hosting | Staging workflow may build only | Commercial plan/ownership verification required before use |

## Approved pilot pricing v3

The commercial pilot pricing decision is now fixed in the branch, but **not yet
activated on staging**. Activation requires a coordinated staging deployment of
the v3 settlement helper and `20260827010000_pilot_pricing_rules_v3.sql`.

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

The approved target payment design is: when at least 30 CHF are available in the
server-side prepaid balance, reserve 30 CHF internally for the rental instead of
requesting an additional Stripe guarantee. The repository already has an
idempotent member-credit ledger reservation/commit/reversal mechanism, but the
full prepaid payment rail must still be wired into rental start and ejection
before this can be advertised as active.

### Non-return

For new `pricing_rules_version=3` rentals, no confirmed return at 72 hours means a
**30 CHF contractual total**, not “duration price + 30 CHF penalty”. v1/v2
snapshots remain immutable and retain their historical settlement semantics.

## Runtime and operations

The rental snapshot is computed server-side and stored with every session. It
contains the price period, daily cap, guarantee, non-return amount, rules version
and hash; settlement rejects a missing or modified snapshot. A rental becomes
active only after server-confirmed financial coverage and physical release
evidence.

The three fixed staging Edge crons run every five minutes: rental email outbox,
membership email outbox and `noop` customer-notification dispatcher (25,920
invocations/month together). All other currently active scheduled jobs are
database-local. See `pre-production-zero-cost-budget-2026-08-26.md`.

Raw advertising impressions are aggregated before deletion after 14 days.
Financial, rental lifecycle and reconciliation data are excluded from that
retention process.

## Customer contract and payment path

The kiosk records an explicit, unchecked acceptance of the current terms and
privacy versions before payment selection. The server records its own timestamp
and rejects QR Checkout or Terminal payment creation without the current
acceptance. The customer-facing payment view also requires a separate unchecked
acceptance before it creates Checkout.

The current public legal routes are:

- `/legal/conditions`
- `/legal/confidentialite`
- `/legal/mentions-legales`

The monetary product decision is now defined above, but public legal identity,
postal address and final human Swiss legal review remain pending. Values displayed
at acceptance must come from the immutable server pricing snapshot; legal pages
must not substitute mutable marketing values for that snapshot.

## Paid external operations

Stripe payment creation, ChargeNow release commands, Resend sends and PassStudio
issuance/pushes are external operations. Tests and staging checks must not call
them unless an explicitly approved test procedure applies. Automatic PassStudio
push/sync is disabled; automatic Resend remains fail-closed when unconfigured.

## Documentation map

| Document | Public route / role | Current status |
| --- | --- | --- |
| `src/pages/LegalPage.tsx` | Legal terms, privacy, legal notice | Pre-production text; company identity and final legal approval pending |
| `src/pages/PaymentChoice.tsx` | Customer web payment acceptance | Current canonical mobile/web acceptance UI |
| `src/pages/Kiosk.tsx` | Kiosk contract review and QR legal access | Current canonical kiosk acceptance UI |
| `PRICING_ENGINE.md` | Approved pilot pricing v3 and versioning semantics | Canonical engineering pricing reference |
| `STRIPE_PAYMENT_MODEL.md` | Stripe guarantee/settlement semantics | Engineering reference |
| `docs/pre-production-runtime-manifest-2026-08-26.md` | Staging runtime inventory | Current hardening evidence |
| `docs/pre-production-zero-cost-budget-2026-08-26.md` | Staging quota model | Current staging cron evidence |

## Do not treat as production approval

This repository does not currently prove a commercial Vercel plan, a completed
legal identity, a deployed prepaid-balance rail, a live Stripe design, or
completed native Apple Wallet push. Human legal approval and coordinated staging
validation of pricing v3/settlement are still required before commercial launch.
