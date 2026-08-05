# First physical ejection report

Status: **not executed in this staging Stripe flow**.

The only permitted checkpoint is:

```text
AUTORISER ÉJECTION TEST DTA21269 SLOT X
```

It requires explicit human confirmation while an attendant is at the cabinet.
Limit the action to staging, DTA21269, one identified slot and one confirmed
paid test rental. Never auto-retry after timeout. Record the provider
request/response, physical observation, battery id, return slot, return event
and final Stripe Test settlement.
