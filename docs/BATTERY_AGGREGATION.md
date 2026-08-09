# Battery aggregation

The kiosk snapshot combines C4 cabinet detail, C7 battery list and C8 slot list
into one per-slot record: presence, id, charge, temperature, online status,
self-check, fault information, confidence, conflicts and source timestamps.

Named parsers keep charge, temperature, voltage, self-check and fault data
separate. Voltage and undocumented fields stay diagnostic-only. A `0%` battery
is never promoted as charging/ready merely because another source is stale.

Conflicting or stale data produces `verification_required`, not a guessed
customer-ready state. The customer view should show `Checking` or unavailable;
admin diagnostics retain source and conflict details.

Evidence: 10 cabinet snapshot unit tests pass locally. No current DTA21269
snapshot is asserted here because that requires a fresh read-only provider
query at the time of the controlled test.
