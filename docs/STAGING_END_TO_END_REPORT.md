# Staging end-to-end report

Status date: 2026-08-06. Environment: staging only. Stripe Live is not enabled.

## Root cause corrected in source

`create-rental-session` received the kiosk token and idempotency key as custom
headers, while its CORS preflight response did not permit either header. A
browser or Android WebView therefore blocked the request before the Edge
Function ran. The kiosk reduced this browser error to a generic French message.

Evidence from the deployed staging preflight before this change:

```text
access-control-allow-headers: authorization, x-client-info, apikey, content-type, x-retry-count
```

The staging kiosk needs `x-kiosk-token` and `x-idempotency-key`. The source now
allows both headers and returns a correlation identifier on rental-session
responses. The kiosk now retains the technical error code, correlation id,
rental session id and failed orchestration step in its protected diagnostics.

## Validation state

| Check | State | Evidence |
| --- | --- | --- |
| TypeScript | passed locally | `npm run typecheck` |
| Kiosk i18n unit tests | passed locally | `src/test/kioskI18n.test.ts` |
| Kiosk CORS / Checkout contract | passed locally | `supabase/functions/tests/kiosk_cors_contract.test.ts` |
| Deploy Edge Functions | deployed | `create-rental-session` v14; `create-stripe-checkout` v16 |
| Frontend staging | deployed | Vercel deployment `dpl_9kBTk7HsD1pqD7dDXMrfBxrBDwej` |
| CORS preflight | verified remotely | response now includes `x-kiosk-token, x-idempotency-key` |
| QR displayed on DTA21269 | not yet re-tested | requires tablet interaction |
| Stripe Test Checkout | not called | no new payment/session created by this change |
| Webhook / ejection / return | not tested | explicit controlled test remains required |

## Safe staging test after deployment

1. Confirm `STRIPE_MODE=test` and `STRIPE_LIVE_ENABLED=false` without exposing values.
2. Open the paired DTA21269 kiosk and select FR, EN, then DE.
3. Confirm the price and press Continue once.
4. Record the diagnostic correlation id and rental session id if a failure occurs.
5. Confirm a hosted `checkout.stripe.com` URL is encoded in the QR; do not pay yet.
6. Test Checkout only on a phone. Do not enable physical ejection without the separate written checkpoint.
