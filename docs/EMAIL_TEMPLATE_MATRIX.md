# Email template matrix

| Event | Customer content | Dispatch state |
| --- | --- | --- |
| Auth confirmation, reset, link, invitation and address change | action link, support, security context | Supabase Auth configuration |
| Rental guarantee confirmed | public rental code, guarantee semantics, tariff context | queued automatically when `paid_at` is recorded |
| Physical rental start | public rental code, confirmed start time, tariff, daily cap, non-return ceiling | queued automatically when `started_at` is recorded |
| Rental completed | exact duration, final price, captured amount, released authorization/refund, return station | queued automatically when rental reaches `completed` |
| Failed / support / non-return | public code and safe status only | dedicated templates still to add |

Rental transaction messages are persisted in `transactional_email_outbox` and processed once per minute by `process-rental-email-outbox`. The outbox is idempotent per rental/template and does not claim a message was sent until the provider confirms the send request.

The worker currently supports a Resend API credential supplied as `RESEND_API_KEY` or the Vault secret `resend_api_key`, plus an optional `transactional_email_from`. If no provider credential is configured, messages remain queued instead of being falsely marked as sent.

Never include kiosk tokens, ChargeNow credentials, Stripe secrets, service-role keys, raw webhook payloads, full card details or unconfirmed battery identifiers.
