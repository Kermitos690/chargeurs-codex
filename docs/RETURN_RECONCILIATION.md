# Return reconciliation

Returns use the physical battery identity, return station, slot and timestamps. Provider callbacks are useful but are not the sole authority: the kiosk cabinet snapshot performs read-only C4/C7/C8/O1 reconciliation and correlates a trustworthy returned battery with the active rental.

Target lifecycle:

```text
active_rental
  -> physical return detected
  -> battery_returned / settling
  -> server pricing from frozen snapshot
  -> Stripe settlement
  -> completed
  -> kiosk + phone final receipt
```

## Customer-facing return states

The public interfaces never invent a financial result:

- `battery_returned` / settlement pending -> **Retour détecté — calcul du montant exact**;
- settlement failure/manual review -> **Retour enregistré — vérification en cours**;
- `completed` + `settlement_status = settled` -> **Location terminée** with confirmed final price.

The final kiosk receipt exposes only non-sensitive operational information: duration, tariff, initial guarantee, captured amount, released authorization or refund, payment-method category, return station/slot and public rental reference. It does not display card numbers or customer email. After 20 seconds, or when the customer presses **Terminer maintenant**, the receipt is acknowledged for that kiosk device and the station returns to its home screen.

The phone progress/receipt surface follows the same server-owned state and keeps the private rental recap available after the kiosk has returned to service.

## Settlement model

Two customer payment paths are explicit because their guarantee semantics differ:

- card rails (including eligible Apple Pay / Google Pay): 30 CHF manual authorization; capture the actual final rental price on return and release the remainder;
- TWINT: 30 CHF prepaid at start; refund the unused balance after return.

Any amount shown as captured, refunded, released or final must come from the persisted server settlement projection.

Cross-station return remains dependent on a trustworthy provider-observed `battery_id`. Duplicate observations are idempotent and cannot close two rentals.
