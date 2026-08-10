# Battery eligibility

A battery is eligible only when its presence, slot and battery identity are
confirmed; data is fresh; cabinet and battery are online; charge meets the
configured threshold; no blocking fault exists; temperature and self-check are
acceptable; and no critical source conflict remains.

Recommendation order is confidence, data freshness, absence of warnings, then
highest charge. The `MIN_RENTAL_BATTERY_PERCENT` decision must be configuration
owned and validated for the actual battery hardware; no UI hardcoded threshold
is evidence of health.

For DTA21269, the observed IDs are test references only and must never be
hardcoded in the customer UI or selection logic.
