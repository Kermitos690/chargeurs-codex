# DTA21269 — P0 Terminal cancellation acceptance

This gate validates cancellation synchronization only. It must not trigger a battery release.

## Preconditions

- Install the signed staging APK `1.0.36-terminal-cancel-lock-staging` (versionCode 136).
- DTA21269 is the terminal-equipped station.
- Do not present a payment card during these cancellation checks.

## Gate A — kiosk cancels WisePad

1. Start a Terminal payment attempt.
2. While the WisePad is collecting, press **Annuler** on the kiosk.
3. Verify the WisePad exits collection.
4. Verify the backend payment rail reaches `CANCELLED`/released state.
5. Verify the kiosk returns to a clean home/payment-ready state only after cancellation is confirmed.

## Gate B — WisePad cancels kiosk

1. Start a new Terminal payment attempt.
2. Cancel/stop on the WisePad.
3. Verify the backend normalizes the cancellation.
4. Verify the kiosk leaves the payment screen automatically.
5. Verify there is no mixed `READY / CANCELLED` state and no stale **Annuler** button.

## Gate C — repeatability

Repeat start → cancel at least three times, alternating kiosk-side and reader-side cancellation.

Pass only if:

- no stale `TERMINAL_BUSY` remains;
- a new attempt can start immediately after each confirmed cancellation;
- no callback from an older attempt changes the newer attempt;
- no duplicate payment side effect occurs;
- no battery is ejected during this gate.
