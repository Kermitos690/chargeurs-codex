# WisePad 3 — Stripe Terminal backend contract / TEST implementation

Issues: #96, #145, #146, #166, canonical contract #169, release gate #171  
Owner: Agent 2 — Payment / Backend  
Scope: Stripe Terminal TEST backend only; QR preserved; pricing/ejection/return semantics unchanged.

## Reader connectivity plane

`stripe-terminal-backend` action `connection_token` is intentionally rental-free.

Input authority:
- `stationId` + authenticated `X-Kiosk-Token` bound to that station;
- Stripe Location / expected reader from server table `stripe_terminal_station_bindings` only;
- TEST Stripe secret only.

It creates no `rental_sessions`, no payment row, no rail claim and no PaymentIntent. This allows Agent 8's connection-only WisePad validation without manufacturing a financial/hardware-capable rental.

## Payment plane

Financial actions require a pre-existing canonical rental owned by the authenticated kiosk:
- `create_payment_intent`;
- `retry_payment_intent`;
- `cancel_payment_intent`;
- `timeout_payment_intent`;
- `get_payment_state`;
- `reconcile_payment_intent`.

The amount remains derived exclusively from `rental_sessions.deposit_amount_cents` / `pricing_snapshot`; currency remains CHF. Terminal creates a TEST `card_present` PaymentIntent with `capture_method=manual`.

## Canonical rail projection

Backend API exposes only:
- `NONE`;
- `TERMINAL`;
- `QR`.

Claim lifecycle is persisted as:
- `engaged`;
- `reconciliation_required`;
- `released`.

Frontend/native progress cannot release a claim. DB first-rail-wins remains authoritative.

## QR ↔ Terminal race safety

`create-stripe-checkout` now calls `claim_rental_payment_rail(..., 'qr_checkout', ...)` **before any Stripe Checkout create/retrieve side effect**.

Terminal similarly claims before PaymentIntent creation.

Therefore:
- simultaneous Terminal vs QR requests serialize on the rental row;
- one rail wins;
- the losing rail returns `PAYMENT_RAIL_ALREADY_CLAIMED` before creating its Stripe object;
- the QR trigger remains defense-in-depth, not the primary claim mechanism.

Existing pre-migration Checkout IDs remain QR-authoritative.

## Cancel / timeout / claim recovery

A Terminal claim can return to `NONE` only after the server can prove one of these conditions:
1. no Stripe side effect occurred; or
2. Stripe confirms the PaymentIntent is canceled / terminally failed and local state is not uncertain.

A PaymentIntent in `requires_capture` or `succeeded` is treated as a confirmed financial side effect and is not released into QR fallback by cancel/timeout.

If Stripe may have accepted a create/cancel request but the server cannot prove the final state, the attempt and claim become `reconciliation_required`. QR remains locked until explicit server reconciliation resolves it.

## Retry / restart

- active existing PaymentIntent + Terminal claim: retrieve/reconcile and reuse; no duplicate PI;
- explicitly canceled/failed/timed-out attempt: a new retry generation is allowed;
- retry generation is part of the Stripe idempotency key;
- prior PaymentIntent IDs are preserved in `previous_payment_intent_ids`;
- restart state is reconstructed from DB claim + attempt + Stripe retrieve, not Android callback memory.

## Authoritative payment confirmation / webhook

The existing signed `stripe-webhook` already handles generic PaymentIntent authorization/failure by `metadata.rental_session_id`, including `payment_intent.amount_capturable_updated` and `payment_intent.payment_failed`.

Terminal PaymentIntents carry the same canonical rental metadata, so the existing server webhook/payment projection remains authoritative. `stripe-terminal-backend` returns `serverConfirmed` only from canonical rental `paid_at`; native SDK callbacks cannot synthesize `PAYMENT_CONFIRMED`.

`reconcile_payment_intent` provides explicit restart/operator reconciliation by retrieving the Stripe PaymentIntent and updating the Terminal attempt projection. Unknown side effects remain fail-closed.

## Correlation

Persisted correlation includes:
- rental session;
- PaymentIntent;
- kiosk device;
- station;
- Stripe Location;
- expected reader;
- attempt generation;
- correlation ID;
- previous PaymentIntent IDs for explicit retry.

No amount, Location or reader supplied by Android/frontend is authoritative.

## Security / TEST-LIVE separation

- station bindings default disabled;
- only `environment=test` bindings are accepted;
- `STRIPE_SECRET_KEY` must be `sk_test_*` or `rk_test_*`;
- Terminal tables are RLS-enabled and direct anon/authenticated access revoked;
- no Stripe secret / ConnectionToken is logged;
- ConnectionToken is ephemeral and not stored in presentation state.

## Protected Core non-changes

No redesign/change to:
- pricing formula or approved amounts;
- deposit/non-return policy;
- hardware ejection commands/retry;
- physical return / BATTERY_IN semantics;
- final settlement formula;
- kiosk/native visual UX.

Existing signed Stripe webhook may continue the already-established payment→rental path after server-confirmed authorization; PR #168 does not add an alternate ejection path.

## Rollback

Exact rollback is documented in `docs/payments/WISEPAD3_STRIPE_TERMINAL_ROLLBACK.md`.

Order:
1. disable Terminal station bindings;
2. remove Terminal function from staging manifest if required;
3. retain QR Checkout;
4. if QR guard trigger itself regresses staging, drop only `rental_sessions_guard_qr_checkout_payment_rail` + `guard_qr_checkout_payment_rail()`;
5. preserve claim/attempt evidence; never delete an uncertain Terminal claim to force QR.

## Targeted tests

`stripe_terminal_backend_contract.test.ts` covers:
1. canonical server-owned amount / CHF / TEST-only key;
2. server-owned Location binding;
3. rental-free ConnectionToken path;
4. canonical `NONE | TERMINAL | QR` projection;
5. rail-state recovery vocabulary;
6. generation-aware idempotency/retry;
7. restart reuse of active PI;
8. cancel/timeout and uncertain-side-effect fail-closed behavior;
9. QR claim before Stripe Checkout side effect;
10. Terminal claim before Stripe PI side effect;
11. existing signed webhook compatibility for Terminal PI metadata;
12. absence of Terminal-side ejection/return/settlement implementation.

## Staging gate

Still not authorized merely by this code commit. Agent 8 #171 requires exact-head test evidence before migration/function deployment. The first physical reader validation may request only a rental-free ConnectionToken and reader connection; no PaymentIntent, payment or battery ejection is required for that connection-only test.
