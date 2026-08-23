# Chargeurs+ — Native Wallet notification contract

Chargeurs.ch is the source of truth. Native Wallet alerts are presentation only and must never block payment, rental, ejection, return, settlement or ChargePoints accounting.

## Delivery model

Every canonical customer `push` notification is mirrored into `customer_wallet_native_notifications` for holders with an active Pass Studio instance.

Current provider state (verified 2026-08-23): Pass Studio documents Campaign lock-screen notifications and Journey-arrival notifications, but the public REST API does not expose a per-holder transactional campaign/notification endpoint. The native intent therefore remains `provider_capability_blocked` with error code `PASS_STUDIO_TRANSACTIONAL_NOTIFICATION_API_UNAVAILABLE` until the provider exposes that capability.

Silent per-holder pass updates continue through `PATCH /instances/fields`; Web Push remains active as the customer-visible fallback.

## Native alert matrix

| Event | Lock-screen content source | Expected native behavior |
| --- | --- | --- |
| Payment / guarantee confirmed | canonical customer push | notify once |
| Rental started / physical battery release | canonical customer push + frozen pricing snapshot | notify once with current amount when available |
| Price stage changed | canonical price-stage event | notify once per new canonical amount |
| Daily cap reached | canonical price-stage event | notify once with exact cap amount |
| Return detected | canonical return event | notify once |
| Rental completed / settled | canonical settlement event | notify once with final amount |
| Rental/payment issue requiring attention | canonical support event | notify once, high relevance |
| ChargePoints bonus / non-rental award | canonical ChargePoints event | notify once |
| Membership renewal / cancellation / expiry | canonical membership notification | notify once |
| Promotion / campaign | canonical customer notification or Pass Studio Campaigns | native campaign when provider targeting fits |

## Safety / idempotency

- one canonical notification row -> at most one native intent (`native:push:<notification_id>`)
- title capped at 100 characters
- lock-screen message capped at 140 characters
- native delivery failure never changes financial or rental state
- no undocumented Pass Studio endpoint may be called
- when Pass Studio exposes transactional per-holder notification delivery, only the provider adapter/outbox consumer should change; business triggers must stay untouched
