# P0 — WisePad 3 + pricing restoration evidence

Date: 2026-08-20
Station: DTA21269

## Proven physical lineage

Supabase kiosk-device history records DTA21269 running:

- `1.0.19-terminal-contract-staging`
- `1.0.20-terminal-contract-staging`

on 2026-08-13, before the later operator-recovery APK.

The current Android source already contains the restored physically-proven Stripe Terminal USB compatibility lane merged by #260 (`b3bd763f5297e0ed2d0238d7d074c6f76e8a7d5f`): Stripe Terminal v2 USB runtime, backend PaymentIntent contract, canonical station/reader binding and staging signer continuity.

## Restoration package

This branch does not roll back the web kiosk, Home, advertising rail, payment safety state machine or hardware quarantine.

It packages the restored terminal contract as a new in-place upgrade:

- versionCode: `131`
- versionName: `1.0.31-terminal-contract-restore`
- staging variant suffix: `-staging`
- Stripe Terminal SDK: `2.23.4`
- USB test lane: enabled only in staging/debug
- hardware ejection remains disabled by this Android build configuration
- backend remains canonical `stripe-terminal-backend`

The purpose is to put the physically installed DTA21269 (currently reporting `1.0.29-operator-recovery-staging`) back onto the proven terminal-contract lineage without downgrading package version or signer identity.

## Physical acceptance

After installation on DTA21269:

1. heartbeat must report `1.0.31-terminal-contract-restore-staging`;
2. WisePad USB snapshot must progress to `READY` / capability `TERMINAL_AND_QR`;
3. Express pricing remains sourced from the server and visible before payment;
4. choosing Terminal creates one server PaymentIntent for the selected rental session and the WisePad shows the corresponding amount;
5. no QR rail may auto-claim while the reader is connecting/reconnecting;
6. no battery ejection/quarantine change is part of this restoration.
