# P0 Ads global crash hotfix — 2026-08-18

The physical DTA21269 entered the global kiosk fail-safe immediately after the partner QR sidecar was mounted outside the isolated Advertising error boundary.

Hotfix decision:
- remove the sidecar mount from `KioskAdvertisingSynchronizedLayer`;
- restore the previous invariant that the synchronized wrapper renders only `KioskAdvertisingLayer`;
- retain the server-side per-media QR data contract for the subsequent canonical integration;
- do not touch rental, payment, return, inventory, pricing or hardware behavior.

Preview `42e5b2063dec7e1103e4de81b8e46c8b2c9eb31c` built successfully on Vercel before merge.
