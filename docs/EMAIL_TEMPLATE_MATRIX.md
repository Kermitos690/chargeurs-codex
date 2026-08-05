# Email template matrix

| Event | Permitted customer data | State |
| --- | --- | --- |
| Auth confirmation, reset, link, invitation and address change | action link, support, security context | configuration required |
| Rental created | public rental code, station, tariff, temporary guarantee | template required |
| Payment, release, return and completed | confirmed events and amounts only | webhook-dependent |
| Failed, expired, cancelled, refund, support, non-return | public code and safe status | template required |

Never include kiosk tokens, Basic credentials, Stripe secrets, service-role
keys, raw webhook payloads or unconfirmed battery identifiers. Supabase Auth
templates require tenant dashboard/SMTP configuration; this repository does
not claim deployment until staging test emails are received.
