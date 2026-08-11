# Incident — native kiosk token lost after APK restart

Date: 2026-08-11
Station: DTA21269

## Field symptom
After a full APK restart, the kiosk remains on the loading/spinner shell and never reaches the owned V3 home.

## Evidence
Supabase Edge logs immediately after restart show repeated HTTP 401 responses for:
- kiosk-cabinet-snapshot
- kiosk-return-summary
- kiosk-ads-playlist
- kiosk-operational-status

The server-side kiosk device for DTA21269 is still active and not revoked. The failure is local credential absence, not a revoked backend device.

## Root cause
`readKioskToken()` reads native credentials from `sessionStorage` first, with `localStorage` only as a legacy/manual fallback. A full APK/WebView restart clears `sessionStorage`. The current Android wrapper is expected to inject `kiosk_token` again on every launch, but the observed field run did not do so.

## Required owner fix
Android/native wrapper must persist the enrolled kiosk credential in protected native storage and inject `sessionStorage['kiosk_token']` before the web application starts issuing kiosk API requests on every WebView creation/restart.

## UX recovery requirement
The web kiosk must not remain on an indefinite spinner when `readKioskToken()` is null. It should show an operator-safe `Borne non authentifiée / activation requise` state and a controlled re-enrollment path.

## Safety
Do not hardcode or expose a kiosk token. Existing server token hashes are one-way and cannot recover the lost raw token. Re-enrollment must rotate to a newly issued token through the existing `kiosk-enroll` pairing mechanism.
