# WisePad 3 — Stripe Terminal backend audit / first TEST implementation

Issues: #96, #145, #146, #166
Owner: Agent 2 — Payment / Backend
Scope: first Stripe Terminal TEST backend foundation only.

## Existing capabilities preserved

- `create-stripe-checkout` remains the QR Checkout implementation.
- Its amount comes from the canonical rental `deposit_amount_cents` / `pricing_snapshot`; browser amount is not authoritative.
- Existing QR Checkout requires a Stripe TEST key on the current staging path.
- Existing rental/ejection/return/settlement engines are not redesigned by this change.

## First implementation

### ConnectionToken
`stripe-terminal-backend` action `connection_token`:
- authenticates `X-Kiosk-Token` against the rental station and kiosk device;
- rejects expired/already-paid rentals;
- requires a Stripe TEST secret key;
- reads Stripe Location and optional expected reader exclusively from `stripe_terminal_station_bindings`;
- creates a Stripe Terminal ConnectionToken scoped to the server-owned Location;
- returns token secret + expected binding to the native TEST client;
- records correlation ID/audit data without logging the token secret.

### TEST PaymentIntent
`stripe-terminal-backend` action `create_payment_intent`:
- uses the canonical rental deposit amount and CHF currency;
- creates `card_present` PaymentIntent with `capture_method=manual`;
- uses a deterministic Stripe idempotency key based on rentalSession + canonical amount + pricing snapshot hash;
- persists rentalSession ↔ PaymentIntent ↔ station ↔ Stripe Location ↔ reader in `stripe_terminal_payment_attempts`;
- also projects `stripe_payment_intent_id` onto the canonical rental session;
- never accepts amount, Location or reader as authoritative client input.

## Payment rail coexistence

QR Checkout remains present. `rental_payment_rail_claims` provides first-rail-wins semantics:
- `qr_checkout`
- `stripe_terminal`

Terminal claims the rail atomically before PaymentIntent creation. A DB trigger protects QR Checkout projection against an existing Terminal claim and records the QR claim for normal QR rentals. Existing rentals that already have a Checkout session remain QR-authoritative.

This is the minimum backend enforcement needed for #166. It does not remove QR or change its payment methods.

## Security / TEST-LIVE separation

- station bindings default disabled;
- only `environment=test` bindings are accepted by the TEST backend helper;
- `STRIPE_SECRET_KEY` must begin `sk_test_` or `rk_test_`;
- new tables are RLS-enabled and direct anon/authenticated access is revoked;
- binding and attempt mutation are server/service-role only;
- the Edge function uses kiosk token authentication because native Terminal needs a ConnectionToken before a Supabase user session exists;
- no Stripe secret or ConnectionToken is stored in source or audit logs.

## Idempotence / recovery boundary

Current first milestone covers idempotent PaymentIntent creation and retry reuse:
- one Terminal attempt row per rental;
- deterministic Stripe idempotency key;
- an existing PaymentIntent is retrieved/reused rather than recreated.

Cancel/process/webhook/restart recovery beyond PI creation remains the next implementation increment. Existing settlement code is intentionally untouched until the Terminal event/reconciliation contract is reviewed under #146.

## Protected Core non-changes

No changes to:
- pricing formula or approved amounts;
- deposit/non-return policy;
- hardware ejection commands or retry logic;
- physical return / BATTERY_IN semantics;
- final settlement calculations;
- kiosk visual UX.

## Configuration required before TEST use

Create a server-side `stripe_terminal_station_bindings` row for the test station with:
- exact station ID;
- Stripe TEST Location ID;
- optional expected Stripe reader ID;
- `environment=test`;
- `enabled=true` only for controlled TEST.

No production/live binding is enabled by this migration.

## Test plan

Automated contract tests cover:
1. canonical server-owned amount;
2. TEST key / CHF guard;
3. TEST station binding requirement;
4. deterministic idempotency;
5. ConnectionToken Location authority is server-owned;
6. `card_present` manual-capture PI contract;
7. rental/PI/reader/location persistence;
8. Terminal rail claim happens before PI create;
9. no Checkout creation inside Terminal backend;
10. no ejection, BATTERY_IN, settlement or pricing-engine mutation.

Next physical/backend gate: deploy migration + function to staging, configure a Stripe TEST Location/reader binding for DTA21269, obtain ConnectionToken from the signed TEST APK, then create/collect/process a Stripe TEST PaymentIntent without any physical battery ejection.
