# WisePad 3 — Android Stripe Terminal USB audit / TEST seam

Status: EXECUTION STARTED — TEST ONLY

Scope: issue #144 under program #166. No pricing, rental, ejection, return/settlement or QR Checkout semantics are changed here.

## Field truth
- Physical reader: BBPOS WisePad 3, USB VID:PID `15a2:0101` (`5538:257`).
- DTA21269 exposes the reader to Android USB host.
- Supplier POS package `com.szbjkj.bajietouchpower` currently owns USB permission on the field unit; it must not be disabled/uninstalled or have permission revoked until the Chargeurs TEST APK is verified to contain Stripe Terminal USB support.
- Current Chargeurs field APK `ch.chargeurs.kiosk.staging` v1.0.15-staging does not contain Stripe Terminal USB integration.

## Current Android baseline
- `compileSdk=36`, `minSdk=26`, `targetSdk=36`, Java 17.
- USB host feature already declared.
- No Stripe Terminal dependency existed on main before this execution branch.
- Native WebView wrapper is `MainActivity`; secure kiosk provisioning is independent from Stripe Terminal.

## Stripe SDK target
Stripe Terminal Android SDK `5.7.0` is used for this TEST lane. Official Stripe examples use `DiscoveryConfiguration.UsbDiscoveryConfiguration` for USB discovery and `ConnectionConfiguration.UsbConnectionConfiguration` with `Terminal.connectReader(...)` for USB readers. The Android process also calls `TerminalApplicationDelegate.onCreate()` from an `Application` subclass.

## First TEST seam
1. Add Stripe Terminal Android SDK to the Android kiosk build.
2. Add an `Application` subclass forwarding lifecycle initialization to `TerminalApplicationDelegate`.
3. Add location permission required by Stripe Terminal reader discovery.
4. Add a native controller responsible only for SDK initialization, USB presence/discovery/connect lifecycle and a safe state snapshot.
5. Expose state to WebView without exposing secrets or payment amount ownership.
6. If reader is not READY, web product remains `QR_ONLY`.
7. No PaymentIntent processing is enabled by this client lane until Agent 2 supplies the TEST ConnectionToken + server-owned intent contract.

## State contract (native -> WebView)
`DISABLED | SDK_READY | USB_ABSENT | DISCOVERING | READER_FOUND | CONNECTING | READY | RECONNECTING | DISCONNECTED | ERROR`

Snapshot fields permitted: state, transport=`usb`, targetVid=`15a2`, targetPid=`0101`, Android USB presence/permission, discovered reader serial/label when supplied by Stripe, lastErrorCode, sanitized lastErrorMessage, build environment.

Forbidden in bridge: Stripe secret keys, connection token values, PaymentIntent client secrets, raw card data, payment amounts supplied by UI.

## Collision / exclusivity
The first APK is verification-only. Installation must not revoke supplier USB ownership automatically. Physical handoff to Chargeurs is a later explicit validation step after package inspection proves Stripe's USB receiver/filter is merged into the APK.

## TEST plan
- CI compile/lint/unit test.
- Inspect built staging APK manifest/package for Stripe Terminal USB receiver/filter and `15a2:0101`.
- Verify package/version/signing provenance.
- Install as update only if signature/package match.
- First field run: no paid/live payment, no ejection. Confirm SDK presence, Android USB detect, permission state, then Stripe USB discovery/connect only once backend ConnectionToken is available.
- Confirm QR path remains available when reader is unavailable.

## Next backend dependency
Agent 2 (#145/#96): authenticated TEST ConnectionToken endpoint and server-owned TEST PaymentIntent contract. Native client must never invent amounts.
