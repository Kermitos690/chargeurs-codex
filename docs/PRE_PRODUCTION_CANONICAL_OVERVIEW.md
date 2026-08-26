# Chargeurs.ch — canonical pre-production overview

Status date: 2026-08-26. This is the current operations and contract reference;
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

## Runtime and operations

The rental snapshot is computed server-side and stored with every session. It
contains the price period, daily cap, guarantee, non-return amount and hash;
settlement rejects a missing or modified snapshot. A rental becomes active only
after server-confirmed payment/authorisation and physical release evidence.

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

Their legal identity, postal address and final commercial terms remain pending
human legal review. Values displayed at acceptance come from the immutable
server pricing snapshot; legal pages must not substitute static marketing prices
for that snapshot.

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
| `STRIPE_PAYMENT_MODEL.md`, `PRICING_ENGINE.md` | Technical payment/pricing semantics | Engineering reference; not customer-facing pricing disclosure |
| `docs/pre-production-runtime-manifest-2026-08-26.md` | Staging runtime inventory | Current hardening evidence |
| `docs/pre-production-zero-cost-budget-2026-08-26.md` | Staging quota model | Current staging cron evidence |

## Do not treat as production approval

This repository does not currently prove a commercial Vercel plan, a completed
legal identity, approved monetary CGV values, live Stripe design, or completed
native Apple Wallet push. Those are production blockers, not issues solvable by
a test-only deployment.
