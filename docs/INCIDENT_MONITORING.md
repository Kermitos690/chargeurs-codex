# Incident monitoring

Create and retain incidents for: stale/offline station, no rentable battery,
battery fault/overtemperature, Stripe webhook error, provider callback 401,
paid-not-ejected, ambiguous ejection, unrecognised return, settlement failure,
and stale/offline kiosk.

Every incident needs severity, station, rental, battery, slot, correlation id,
first/last seen, owner, status and resolution. The admin must show active
incidents and a rental timeline without requiring direct database access.

This document defines the requirement. Automatic incident generation and
operator alert delivery are not yet demonstrated, so monitoring is not
FIELD_READY.
