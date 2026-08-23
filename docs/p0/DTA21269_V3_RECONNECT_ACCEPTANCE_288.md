# DTA21269 v3 reconnect acceptance — issue #288

No payment card and no battery ejection are required for this gate.

1. Reboot DTA21269 with WisePad connected.
2. Reader must reach `READY` and capability `TERMINAL_AND_QR`.
3. If the kiosk remains in a transient reader state, press Retry once. Retry must invalidate stale local connect/discovery guards and re-enter discovery instead of no-oping.
4. Start a Terminal attempt without presenting a card; cancel on kiosk. WisePad and kiosk must both leave payment collection.
5. Start again and cancel on WisePad. Kiosk must leave the payment stage automatically.
6. Repeat alternating cancellation three times with no `TERMINAL_BUSY` residue.
7. Unplug WisePad before a fresh payment choice: explicit `ABSENT` must fall back to QR.
8. Reconnect WisePad: retry/recovery must return to `READY`.

Safety invariants: pricing, deposit/caution, capture, settlement, rental release and hardware ejection remain unchanged.