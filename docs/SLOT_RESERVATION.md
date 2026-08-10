# Atomic slot reservation

The browser may suggest a slot but cannot reserve it. The server checks the
fresh provider snapshot, then calls `create_reserved_kiosk_rental_session`.
That RPC takes a transaction-scoped advisory lock for `station_id:slot_num`,
expires old reservations, creates the rental and inserts its reservation in the
same transaction. A partial unique index permits one `reserved` row per station
and slot. The resulting `selected_slot_num` is server-derived.

After payment, the reservation is consumed only for an ejected/active rental.
Failure and expiry release it. A changed or invalid slot before dispatch must
enter review; the system must not quietly pick a different battery.

Status: IMPLEMENTED locally; not yet INTEGRATION_TESTED on staging. The index
does not prove that a provider will deliver the same physical battery.
