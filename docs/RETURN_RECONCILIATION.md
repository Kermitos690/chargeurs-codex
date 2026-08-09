# Return reconciliation

Returns must use `battery_id`, station, slot, timestamp and a deduplicated
provider external event. A repeated observation is idempotent and cannot close
two rentals.

Target lifecycle:

```text
active_rental -> return_detected -> settling -> completed
```

The server must handle same-slot and different-slot return explicitly. Any
cross-station support depends on a provider-verified battery identity. No
return claim becomes complete until pricing and payment settlement succeed.

Status: inbox and correlation primitives exist; a complete automated physical
return and Test settlement are not yet proven.
