# DTA21269 v3 reconnect blocker — issue #288

Field evidence on 2026-08-23: WisePad is USB-powered and displays Stripe, while the kiosk remains in `Connexion au terminal...`; pressing Retry does not reach `READY`.

The v3 runtime currently returns early from `requestReconnect()` whenever `connectionRunning` is true (except the offline-cache special case). A stalled `connectUsbReader` operation can therefore make the Retry button a no-op indefinitely.

Repair requirement: explicit Retry must be able to invalidate a stale connection generation when no payment is active, reset local discovery/connection guards, and re-enter the USB discovery path without touching pricing, settlement, rental release, or hardware ejection.

This document is diagnostic evidence only; the actual runtime fix must remain on the Stripe Terminal 3.0.0 USB lineage.