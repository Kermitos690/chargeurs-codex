# Agent 4 — Kiosk authentication fail-safe

Incident: #102

Scope: presentation/recovery only. No credential generation, persistence, rotation, enrollment, backend auth, pricing, payment, rental, hardware or Ads business logic changes.

Goal:
- never leave the physical kiosk on an indefinite loading spinner when the station credential is missing/rejected;
- distinguish HTTP 401/403 from transport failures in the existing same-origin kiosk proxy;
- surface an explicit FR/EN/DE `Borne non authentifiée / activation requise` state;
- keep raw kiosk credentials out of UI/logs;
- allow a safe page retry after the native wrapper/operator has restored enrollment.

Native credential persistence/reinjection remains owned by Agent 3/native wrapper via issue #102.
