# Rental state machine

## Server authority

`rental_sessions.state` is the business authority. The kiosk is a projection
only and receives `state_version` with every polling response.

```text
created -> payment_pending -> payment_succeeded -> slot_reserved
        -> ejecting -> ejected -> active_rental -> return_detected
        -> settling -> completed
```

Exception paths are `payment_failed`, `payment_expired`, `payment_cancelled`,
`eject_failed`, `chargenow_failed`, `settlement_failed`, `manual_review` and
`needs_support`.

## Guard

Migration `20260809000001_field_deployment_state_and_reservations.sql` adds a
state rank, a transition trigger and a monotonically incremented
`state_version`. A stale lower-ranked update is rejected. The kiosk ignores a
poll response whose version is lower than the version already rendered.

## Limits

This is IMPLEMENTED and AUTOMATED_TESTED at unit/contract level only. It is
not DEPLOYED_STAGING and does not prove a provider callback, return or
settlement sequence.
