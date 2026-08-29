# Chargeurs.ch — Supabase Edge Function Inventory

Status date: **2026-08-29**
Runtime audited: Supabase staging xqepbqnaenoeyfjkjnzl

This register is documentation only. No function is deployed, modified or
deleted by this phase.

## Baseline

| Measure | Count |
|---|---:|
| Active Edge Functions in staging runtime | 100 |
| Function directories in main, excluding shared/tests | 59 |
| Runtime-only functions | 42 |
| Git-only functions | 1 |
| Temporary/diagnostic/one-shot candidates | 30 |
| Runtime functions with verify_jwt=false | 65 |

The counts reconcile because 58 names occur on both sides:
100 runtime = 58 common + 42 runtime-only; 59 Git = 58 common + 1 Git-only.

verify_jwt=false does not by itself prove unauthenticated access. It means the
Supabase JWT gateway is not enforcing a JWT. Effective authorization may be a
kiosk token, provider signature, Stripe signature, API key, service-role
boundary or custom RBAC. Where source or caller evidence is missing, this
register deliberately records UNKNOWN.

## Classification vocabulary

- CORE_RUNTIME: shared rental/platform operation not better classified below.
- PAYMENT: Checkout, PaymentIntent, settlement or Stripe webhook.
- KIOSK: kiosk enrollment, session, presentation or proxy API.
- CHARGENOW: cabinet/provider status, release, ejection or return.
- TERMINAL: Stripe Terminal-specific backend.
- ACCOUNT: customer account, privacy or claim.
- ADMIN: authenticated operational/back-office surface.
- WALLET: membership, prepaid, Charge Points or Apple Wallet.
- ADVERTISING: advertising assets, playlist or redirect.
- OPERATIONS: background delivery, gateway or operational ingestion.
- DIAGNOSTIC: read-only/probe/self-test intent suggested by evidence.
- ONE_SHOT: operation named as a single-use action; not proof that it is unused.
- UNKNOWN: purpose cannot yet be established.

## Runtime inventory

Evidence/confidence in this table applies only to function name, runtime status,
verify_jwt and Git-directory presence. Effective authorization and caller fields
remain LOW/UNKNOWN until source plus logs/configuration are reviewed.

| Function | Category | Git source | Runtime active | verify_jwt | Effective auth | Known caller | Cron/webhook dependency | Retirement candidate | Evidence/confidence |
|---|---|---:|---:|---:|---|---|---|---|---|
| account-privacy | ACCOUNT | YES | YES | true | JWT gateway; internal RBAC TBD | Account frontend candidate | UNKNOWN | NO/UNKNOWN | Runtime + Git / HIGH |
| admin-api-coverage-read | ADMIN | YES | YES | true | JWT gateway; internal RBAC TBD | Admin frontend candidate | UNKNOWN | NO/UNKNOWN | Runtime + Git / HIGH |
| admin-customer-program | ADMIN | YES | YES | true | JWT gateway; internal RBAC TBD | Admin frontend candidate | UNKNOWN | NO/UNKNOWN | Runtime + Git / HIGH |
| admin-finance-read | ADMIN | YES | YES | true | JWT gateway; internal RBAC TBD | Admin frontend candidate | UNKNOWN | NO/UNKNOWN | Runtime + Git / HIGH |
| admin-health-read | ADMIN | YES | YES | true | JWT gateway; internal RBAC TBD | Admin frontend candidate | UNKNOWN | NO/UNKNOWN | Runtime + Git / HIGH |
| admin-maintenance-action | ADMIN | YES | YES | true | JWT gateway; internal RBAC TBD | Admin frontend candidate | UNKNOWN | NO/UNKNOWN | Runtime + Git / HIGH |
| admin-operations-read | ADMIN | YES | YES | true | JWT gateway; internal RBAC TBD | Admin frontend candidate | UNKNOWN | NO/UNKNOWN | Runtime + Git / HIGH |
| admin-overview-read | ADMIN | YES | YES | true | JWT gateway; internal RBAC TBD | Admin frontend candidate | UNKNOWN | NO/UNKNOWN | Runtime + Git / HIGH |
| admin-settings-read | ADMIN | YES | YES | true | JWT gateway; internal RBAC TBD | Admin frontend candidate | UNKNOWN | NO/UNKNOWN | Runtime + Git / HIGH |
| admin-test-monitor-read | ADMIN | YES | YES | true | JWT gateway; internal RBAC TBD | Admin frontend candidate | UNKNOWN | NO/UNKNOWN | Runtime + Git / HIGH |
| admin-users | ADMIN | YES | YES | true | JWT gateway; internal RBAC TBD | Admin frontend candidate | UNKNOWN | NO/UNKNOWN | Runtime + Git / HIGH |
| ads-admin | ADVERTISING | YES | YES | true | JWT gateway; internal RBAC TBD | Admin advertising UI candidate | UNKNOWN | NO/UNKNOWN | Runtime + Git / HIGH |
| ads-qr-redirect | ADVERTISING | YES | YES | false | Public/custom auth to verify | Public redirect candidate | UNKNOWN | NO/UNKNOWN | Runtime + Git / HIGH |
| api-key-admin | ADMIN | YES | YES | true | JWT gateway; internal RBAC TBD | Admin/API management candidate | UNKNOWN | NO/UNKNOWN | Runtime + Git / HIGH |
| apple-wallet-pass | WALLET | NO | YES | false | UNKNOWN | UNKNOWN | Apple Wallet protocol candidate | NO/UNKNOWN | Runtime-only / HIGH |
| apple-wallet-sync | WALLET | NO | YES | true | JWT gateway; internal RBAC TBD | UNKNOWN | UNKNOWN | NO/UNKNOWN | Runtime-only / HIGH |
| apple-wallet-web-service | WALLET | NO | YES | false | UNKNOWN | Apple Wallet service candidate | External webhook candidate | NO/UNKNOWN | Runtime-only / HIGH |
| cabinet-event-push | CHARGENOW | YES | YES | false | Provider signature/custom auth TBD | ChargeNow/provider candidate | External webhook candidate | NO/UNKNOWN | Runtime + Git / HIGH |
| cabinet-event-push-auth | CHARGENOW | YES | YES | false | Provider signature/custom auth TBD | ChargeNow/provider candidate | External webhook candidate | NO/UNKNOWN | Runtime + Git / HIGH |
| cabinet-slot-diagnostics | DIAGNOSTIC | YES | YES | false | Custom auth UNKNOWN | Operator/diagnostic candidate | UNKNOWN | YES — proof required | Runtime + Git / HIGH |
| cancel-kiosk-checkout | PAYMENT | YES | YES | false | Kiosk/application auth TBD | Web kiosk via Vercel proxy | UNKNOWN | NO/UNKNOWN | Runtime + Git / HIGH |
| chargenow-admin | CHARGENOW | YES | YES | true | JWT gateway; admin RBAC TBD | Admin/operator candidate | UNKNOWN | NO/UNKNOWN | Runtime + Git / HIGH |
| chargenow-readonly-audit | DIAGNOSTIC | NO | YES | true | JWT gateway; internal RBAC TBD | UNKNOWN | UNKNOWN | NO/UNKNOWN | Runtime-only / HIGH |
| chargenow-rent-callback | CHARGENOW | YES | YES | false | Provider callback auth TBD | ChargeNow/provider candidate | External webhook candidate | NO/UNKNOWN | Runtime + Git / HIGH |
| claim-admin | ACCOUNT | YES | YES | true | JWT gateway; internal RBAC TBD | Account/admin candidate | UNKNOWN | NO/UNKNOWN | Runtime + Git / HIGH |
| close-rental-order | CORE_RUNTIME | YES | YES | true | JWT gateway; internal RBAC TBD | UNKNOWN | UNKNOWN | NO/UNKNOWN | Runtime + Git / HIGH |
| create-rental-session | KIOSK | YES | YES | false | Kiosk token/custom auth TBD | Web kiosk via Vercel proxy | UNKNOWN | NO/UNKNOWN | Runtime + Git / HIGH |
| create-stripe-checkout | PAYMENT | YES | YES | false | Kiosk/session auth TBD | Web kiosk via Vercel proxy | UNKNOWN | NO/UNKNOWN | Runtime + Git / HIGH |
| customer-membership-checkout | WALLET | YES | YES | true | JWT gateway; user ownership TBD | Account frontend candidate | Stripe callback dependency possible | NO/UNKNOWN | Runtime + Git / HIGH |
| customer-membership-manage | WALLET | YES | YES | true | JWT gateway; user ownership TBD | Account frontend candidate | UNKNOWN | NO/UNKNOWN | Runtime + Git / HIGH |
| customer-pairing-claim | KIOSK | YES | YES | true | JWT gateway; pairing checks TBD | Customer mobile/account candidate | UNKNOWN | NO/UNKNOWN | Runtime + Git / HIGH |
| customer-pairing-create | KIOSK | YES | YES | false | Kiosk token/custom auth TBD | Web kiosk via Vercel proxy | UNKNOWN | NO/UNKNOWN | Runtime + Git / HIGH |
| customer-pairing-status | KIOSK | YES | YES | false | Pairing/session auth TBD | Web kiosk via Vercel proxy | UNKNOWN | NO/UNKNOWN | Runtime + Git / HIGH |
| device-shadow-ingest | OPERATIONS | NO | YES | false | UNKNOWN | UNKNOWN | Device/provider ingest candidate | NO/UNKNOWN | Runtime-only / HIGH |
| dta-pilot-callback | CHARGENOW | YES | YES | false | Provider/custom auth TBD | DTA pilot candidate | External callback candidate | NO/UNKNOWN | Runtime + Git / HIGH |
| dta-pilot-preflight | DIAGNOSTIC | YES | YES | true | JWT gateway; operator RBAC TBD | Operator/CI candidate | UNKNOWN | NO/UNKNOWN | Runtime + Git / HIGH |
| dta-pilot-qualification | DIAGNOSTIC | YES | YES | true | JWT gateway; operator RBAC TBD | Operator/CI candidate | UNKNOWN | NO/UNKNOWN | Runtime + Git / HIGH |
| eject-after-payment | CHARGENOW | YES | YES | false | Server/payment proof controls TBD | Backend orchestration candidate | Payment workflow candidate | NO/UNKNOWN | Runtime + Git / HIGH |
| inventory-admin | ADMIN | YES | YES | true | JWT gateway; admin RBAC TBD | Admin inventory UI candidate | UNKNOWN | NO/UNKNOWN | Runtime + Git / HIGH |
| inventory-catalog | CORE_RUNTIME | NO | YES | true | JWT gateway; authorization TBD | UNKNOWN | UNKNOWN | NO/UNKNOWN | Runtime-only / HIGH |
| kiosk-admin | ADMIN | YES | YES | true | JWT gateway; admin RBAC TBD | Admin kiosk UI candidate | UNKNOWN | NO/UNKNOWN | Runtime + Git / HIGH |
| kiosk-ads-clock | ADVERTISING | YES | YES | false | Kiosk/custom auth TBD | Web kiosk via Vercel proxy | UNKNOWN | NO/UNKNOWN | Runtime + Git / HIGH |
| kiosk-ads-playlist | ADVERTISING | YES | YES | false | Kiosk/custom auth TBD | Web kiosk via Vercel proxy | UNKNOWN | NO/UNKNOWN | Runtime + Git / HIGH |
| kiosk-cabinet-snapshot | KIOSK | YES | YES | false | Kiosk/custom auth TBD | Web kiosk via Vercel proxy | UNKNOWN | NO/UNKNOWN | Runtime + Git / HIGH |
| kiosk-customer-options | KIOSK | YES | YES | false | Kiosk/custom auth TBD | Web kiosk via Vercel proxy | UNKNOWN | NO/UNKNOWN | Runtime + Git / HIGH |
| kiosk-enroll | KIOSK | YES | YES | false | One-time enrollment controls TBD | Android enrollment | UNKNOWN | NO/UNKNOWN | Runtime + Git / HIGH |
| kiosk-operational-status | KIOSK | YES | YES | false | Kiosk/custom auth TBD | Web kiosk candidate | UNKNOWN | NO/UNKNOWN | Runtime + Git / HIGH |
| kiosk-operator-unlock | ADMIN | NO | YES | true | JWT gateway; operator RBAC TBD | UNKNOWN | UNKNOWN | NO/UNKNOWN | Runtime-only / HIGH |
| kiosk-remote-control | ADMIN | NO | YES | false | UNKNOWN | UNKNOWN | UNKNOWN | NO/UNKNOWN | Runtime-only / HIGH |
| kiosk-resume-state | KIOSK | YES | YES | false | Kiosk/session auth TBD | Web kiosk via Vercel proxy | UNKNOWN | NO/UNKNOWN | Runtime + Git / HIGH |
| kiosk-return-summary | KIOSK | YES | YES | false | Kiosk/session auth TBD | Web kiosk via Vercel proxy | UNKNOWN | NO/UNKNOWN | Runtime + Git / HIGH |
| local-gateway-api | OPERATIONS | NO | YES | false | UNKNOWN | Local gateway candidate | UNKNOWN | NO/UNKNOWN | Runtime-only / HIGH |
| maintenance-free-return-slot-once | ONE_SHOT | NO | YES | true | JWT gateway; maintenance RBAC TBD | UNKNOWN | UNKNOWN | YES — proof required | Runtime-only / HIGH |
| noop | DIAGNOSTIC | NO | YES | false | UNKNOWN | UNKNOWN | UNKNOWN | YES — proof required | Runtime-only / HIGH |
| noop-placeholder | DIAGNOSTIC | NO | YES | true | JWT gateway; authorization TBD | UNKNOWN | UNKNOWN | YES — proof required | Runtime-only / HIGH |
| noop-schema-probe | DIAGNOSTIC | NO | YES | false | UNKNOWN | UNKNOWN | UNKNOWN | YES — proof required | Runtime-only / HIGH |
| noopDiscovery | DIAGNOSTIC | NO | YES | true | JWT gateway; authorization TBD | UNKNOWN | UNKNOWN | YES — proof required | Runtime-only / HIGH |
| operator-o2-single-command-qualification | DIAGNOSTIC | NO | YES | false | UNKNOWN | Operator candidate | UNKNOWN | NO/UNKNOWN | Runtime-only / HIGH |
| ops-ad-upload-once | ONE_SHOT | NO | YES | true | JWT gateway; authorization TBD | UNKNOWN | UNKNOWN | YES — proof required | Runtime-only / HIGH |
| ops-callback-auth-selftest-once | DIAGNOSTIC | NO | YES | false | UNKNOWN | UNKNOWN | Callback self-test candidate | YES — proof required | Runtime-only / HIGH |
| ops-cancel-broken-authorization-once | ONE_SHOT | NO | YES | false | UNKNOWN | UNKNOWN | Stripe dependency candidate | YES — proof required | Runtime-only / HIGH |
| ops-cancel-current-multirelease-authorization-once | ONE_SHOT | NO | YES | false | UNKNOWN | UNKNOWN | Stripe dependency candidate | YES — proof required | Runtime-only / HIGH |
| ops-configure-chargenow-events-once | ONE_SHOT | NO | YES | false | UNKNOWN | UNKNOWN | ChargeNow configuration candidate | YES — proof required | Runtime-only / HIGH |
| ops-eject-47c998bd702743f688bc381003db54a5 | ONE_SHOT | NO | YES | false | UNKNOWN | UNKNOWN | Hardware mutation candidate | YES — proof required | Runtime-only / HIGH |
| ops-eject-dta21269-slot2-once | ONE_SHOT | NO | YES | false | UNKNOWN | UNKNOWN | Hardware mutation candidate | YES — proof required | Runtime-only / HIGH |
| ops-eject-dta21269-slot3-once | ONE_SHOT | NO | YES | false | UNKNOWN | UNKNOWN | Hardware mutation candidate | YES — proof required | Runtime-only / HIGH |
| ops-expire-broken-checkout-once | ONE_SHOT | NO | YES | false | UNKNOWN | UNKNOWN | Stripe dependency candidate | YES — proof required | Runtime-only / HIGH |
| ops-free-slot1-for-return-once | ONE_SHOT | NO | YES | false | UNKNOWN | UNKNOWN | Hardware mutation candidate | YES — proof required | Runtime-only / HIGH |
| ops-o2-only-release-test-once | ONE_SHOT | NO | YES | false | UNKNOWN | UNKNOWN | Hardware mutation candidate | YES — proof required | Runtime-only / HIGH |
| ops-readonly-active-order-check-once | DIAGNOSTIC | NO | YES | false | UNKNOWN | UNKNOWN | UNKNOWN | YES — proof required | Runtime-only / HIGH |
| ops-readonly-current-payment-once | DIAGNOSTIC | NO | YES | false | UNKNOWN | UNKNOWN | Stripe dependency candidate | YES — proof required | Runtime-only / HIGH |
| ops-readonly-dta21269-snapshot | DIAGNOSTIC | NO | YES | false | UNKNOWN | UNKNOWN | ChargeNow dependency candidate | YES — proof required | Runtime-only / HIGH |
| ops-readonly-payment-intent-once | DIAGNOSTIC | NO | YES | false | UNKNOWN | UNKNOWN | Stripe dependency candidate | YES — proof required | Runtime-only / HIGH |
| ops-readonly-rental-detail-once | DIAGNOSTIC | NO | YES | false | UNKNOWN | UNKNOWN | UNKNOWN | YES — proof required | Runtime-only / HIGH |
| ops-readonly-return-order-once | DIAGNOSTIC | NO | YES | false | UNKNOWN | UNKNOWN | ChargeNow dependency candidate | YES — proof required | Runtime-only / HIGH |
| ops-readonly-two-orders-once | DIAGNOSTIC | NO | YES | false | UNKNOWN | UNKNOWN | ChargeNow dependency candidate | YES — proof required | Runtime-only / HIGH |
| ops-reconcile-return-and-settle-once | ONE_SHOT | NO | YES | false | UNKNOWN | UNKNOWN | Stripe + ChargeNow candidate | YES — proof required | Runtime-only / HIGH |
| ops-recover-current-manual-card-once | ONE_SHOT | NO | YES | false | UNKNOWN | UNKNOWN | Stripe dependency candidate | YES — proof required | Runtime-only / HIGH |
| ops-repair-stuck-release-return-once | ONE_SHOT | NO | YES | false | UNKNOWN | UNKNOWN | Hardware + payment candidate | YES — proof required | Runtime-only / HIGH |
| ops-settle-one-test-rental | ONE_SHOT | NO | YES | false | UNKNOWN | UNKNOWN | Stripe dependency candidate | YES — proof required | Runtime-only / HIGH |
| ops-stripe-checkout-variant-selftest-once | DIAGNOSTIC | NO | YES | false | UNKNOWN | UNKNOWN | Stripe dependency candidate | YES — proof required | Runtime-only / HIGH |
| ops-stripe-webhook-endpoint-once | ONE_SHOT | NO | YES | false | UNKNOWN | UNKNOWN | Stripe webhook candidate | YES — proof required | Runtime-only / HIGH |
| payment-portal | PAYMENT | YES | YES | false | Session/custom auth TBD | Customer frontend candidate | UNKNOWN | NO/UNKNOWN | Runtime + Git / HIGH |
| platform-api | ADMIN | YES | YES | false | API key/custom auth TBD | External/admin API candidate | UNKNOWN | NO/UNKNOWN | Runtime + Git / HIGH |
| platform-api-webhook-dispatcher | OPERATIONS | YES | YES | true | JWT gateway; service authorization TBD | Background dispatcher candidate | Webhook dependency | NO/UNKNOWN | Runtime + Git / HIGH |
| pricing-admin | ADMIN | YES | YES | true | JWT gateway; admin RBAC TBD | Admin pricing UI candidate | UNKNOWN | NO/UNKNOWN | Runtime + Git / HIGH |
| pricing-admin-read | ADMIN | YES | YES | true | JWT gateway; admin RBAC TBD | Admin pricing UI candidate | UNKNOWN | NO/UNKNOWN | Runtime + Git / HIGH |
| process-membership-email-outbox | OPERATIONS | YES | YES | false | Service/Cron auth TBD | Cron candidate | Cron dependency candidate | NO/UNKNOWN | Runtime + Git / HIGH |
| process-rental-email-outbox | OPERATIONS | YES | YES | false | Service/Cron auth TBD | Cron candidate | Cron dependency candidate | NO/UNKNOWN | Runtime + Git / HIGH |
| public-contact | CORE_RUNTIME | YES | YES | false | Public abuse controls TBD | Public frontend candidate | UNKNOWN | NO/UNKNOWN | Runtime + Git / HIGH |
| public-payment-status | PAYMENT | NO | YES | false | UNKNOWN | Payment status frontend candidate | UNKNOWN | NO/UNKNOWN | Runtime-only / HIGH |
| public-stripe-checkout | PAYMENT | YES | YES | false | Public/session controls TBD | Public frontend candidate | Stripe dependency | NO/UNKNOWN | Runtime + Git / HIGH |
| reconcile-pending-ejection | CHARGENOW | YES | YES | false | Kiosk/server auth TBD | Web kiosk via Vercel proxy | ChargeNow dependency | NO/UNKNOWN | Runtime + Git / HIGH |
| rental-admin-action | ADMIN | YES | YES | true | JWT gateway; admin RBAC TBD | Admin rental UI candidate | UNKNOWN | NO/UNKNOWN | Runtime + Git / HIGH |
| settle-rental-payment | PAYMENT | YES | YES | false | Server/webhook controls TBD | Backend orchestration candidate | Stripe dependency | NO/UNKNOWN | Runtime + Git / HIGH |
| stripe-terminal-backend | TERMINAL | NO | YES | false | UNKNOWN | Web kiosk proxy and Android candidate | Stripe Terminal dependency | NO/UNKNOWN | Runtime-only / HIGH |
| stripe-test-intent-inspect | DIAGNOSTIC | NO | YES | false | UNKNOWN | UNKNOWN | Stripe TEST dependency | NO/UNKNOWN | Runtime-only / HIGH |
| stripe-webhook | PAYMENT | YES | YES | false | Stripe signature expected; verify source/runtime | Stripe | External webhook | NO/UNKNOWN | Runtime + Git / HIGH |
| stripe-webhook-gateway | PAYMENT | YES | YES | false | Stripe signature expected; verify source/runtime | Stripe | External webhook | NO/UNKNOWN | Runtime + Git / HIGH |
| sync-cabinet-status | CHARGENOW | YES | YES | false | Service/provider auth TBD | Backend/provider candidate | Provider polling/callback TBD | NO/UNKNOWN | Runtime + Git / HIGH |

## Git-only function

| Function | Category | Git source | Runtime active | Disposition |
|---|---|---:|---:|---|
| dta21269-single-slot-quarantine-resolver | CHARGENOW | YES | NO | UNKNOWN — determine whether undeployed source, superseded source or required recovery |

## Runtime-only functions

The 42 runtime-only names are:

- apple-wallet-pass
- apple-wallet-sync
- apple-wallet-web-service
- chargenow-readonly-audit
- device-shadow-ingest
- inventory-catalog
- kiosk-operator-unlock
- kiosk-remote-control
- local-gateway-api
- maintenance-free-return-slot-once
- noop
- noop-placeholder
- noop-schema-probe
- noopDiscovery
- operator-o2-single-command-qualification
- ops-ad-upload-once
- ops-callback-auth-selftest-once
- ops-cancel-broken-authorization-once
- ops-cancel-current-multirelease-authorization-once
- ops-configure-chargenow-events-once
- ops-eject-47c998bd702743f688bc381003db54a5
- ops-eject-dta21269-slot2-once
- ops-eject-dta21269-slot3-once
- ops-expire-broken-checkout-once
- ops-free-slot1-for-return-once
- ops-o2-only-release-test-once
- ops-readonly-active-order-check-once
- ops-readonly-current-payment-once
- ops-readonly-dta21269-snapshot
- ops-readonly-payment-intent-once
- ops-readonly-rental-detail-once
- ops-readonly-return-order-once
- ops-readonly-two-orders-once
- ops-reconcile-return-and-settle-once
- ops-recover-current-manual-card-once
- ops-repair-stuck-release-return-once
- ops-settle-one-test-rental
- ops-stripe-checkout-variant-selftest-once
- ops-stripe-webhook-endpoint-once
- public-payment-status
- stripe-terminal-backend
- stripe-test-intent-inspect

## Retirement proof required

No retirement is authorized by this inventory. A candidate may be retired only
after all of the following are proven:

1. no frontend or Android reference;
2. no Edge Function-to-function call;
3. no active Cron job;
4. no Stripe, ChargeNow, wallet or other external webhook registration;
5. no operator runbook or workflow dependency;
6. sufficient runtime log window with no unexplained invocation;
7. source and deployed bundle retained for rollback/audit;
8. security review confirms that retirement will not open a fallback path.

Current status: ONE_CANONICAL_EDGE_FUNCTION_SOURCE_SET is **NOT ACHIEVED**.
