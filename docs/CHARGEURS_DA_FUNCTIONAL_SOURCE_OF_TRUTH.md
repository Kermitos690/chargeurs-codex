# CHARGEURS.CH — DA & FUNCTIONAL SOURCE OF TRUTH

Status: CANONICAL
Effective date: 2026-08-10
Scope: kiosk, mobile rental follow-up, CSS/UI reconstruction, customer journeys.

This document supersedes any older mockup, screen flow, CSS experiment, branch note, or visual that conflicts with the rules below.

## 1. COLOR SYSTEM
- Neon green = Location Express, no account.
- Electric blue / cyan = Client Chargeurs / Chargeurs.ch+.
- Electric violet = Pass & subscriptions.
- Success green = confirmations only.

## 2. ART DIRECTION
- Kiosk target format: 16:9.
- Deep black / midnight-blue background.
- Premium 3D DA: controlled glow, volumetric smoke, reflections, depth.
- Dark glass cards, thin luminous borders, large corner radii.
- Large touch targets and very few CTAs.
- Absolutely avoid a flat SaaS-dashboard look.
- QR codes must remain flat, crisp, high-contrast and perfectly scannable.

## 3. PRICING / BACKEND AUTHORITY
- Tariffs, discounts, included hours, caps, guarantee/deposit and all commercial parameters come from the backend.
- No figure visible in a mockup may become a hard-coded product constant.
- UI only renders values returned by the authoritative backend for the active station/session/customer segment.

## 4. LOCATION EXPRESS
- No-account journey.
- Green visual universe.
- Payment on the customer's phone via QR.
- Once the battery is physically withdrawn, the kiosk journey ends.

## 5. CLIENT CHARGEURS
- Blue visual universe.
- Login only through an ephemeral QR scanned with the customer's phone camera.
- No personal data is entered on the kiosk.
- Temporary kiosk session only.
- Automatic logout after rental completion, abandonment, expiry/inactivity or incident.
- Once the battery is physically withdrawn, the kiosk journey ends; ongoing rental tracking moves to the phone.

## 6. RETURN
- No mandatory preliminary Return button.
- Physical reinsertion of a battery automatically triggers the return flow.
- Recognized battery -> attach to rental -> stop/close billing -> confirmation.
- After confirmation, automatically return to the home screen.
- Never show a payment-choice screen after a return.

## 7. HELP / FAQ
- Cross-cutting function available from relevant screens.
- It is NOT a journey step.
- Never display “Step 5 — Help” or equivalent.
- Return from Help to the originating screen where relevant.

## 8. MOBILE
- Once the customer has left the kiosk, the phone carries the rental follow-up.
- The kiosk must not add redundant rental-tracking screens.

## 9. UX PRINCIPLE
- Minimize the number of steps.
- One screen = one action or one indispensable piece of information.
- Never create a new step merely to explain an action that has already completed.

## 10. VISUAL REFERENCE INTERPRETATION
The validated Chargeurs.ch UI reference PDF is a visual-direction reference, not a literal functional specification where it conflicts with this document.

Use its premium 3D language, black/blue-night composition, luminous cards, typography hierarchy, kiosk framing and mobile continuity as visual inspiration.

Known superseded visual details:
- Any visual sequence that labels Help/FAQ as a numbered step is invalid.
- Any preliminary Return screen that the customer must deliberately enter before physically reinserting a battery is invalid.
- Any pricing, discount, deposit, included-time or cap value shown in a mockup is illustrative only until supplied by the backend.

## 11. KIOSK FLOW TARGETS
### Express
Home -> Express -> indispensable battery/payment choice -> payment QR when required -> physical release -> take-battery confirmation -> Home.

### Client
Home -> Client -> ephemeral login QR -> indispensable battery/payment choice -> physical release -> take-battery confirmation -> logout -> Home.

### Return
Physical reinsertion -> automatic detection -> rental association -> billing closure -> success confirmation -> Home.

### Help
Overlay / modal / dedicated assistance surface from relevant screens -> return to originating context. Never part of numbered progress.

## 12. IMPLEMENTATION GUARDRAILS
- Do not touch the Android APK for normal frontend DA iterations unless explicitly authorized.
- Preserve server-authoritative rental state and hardware safety controls.
- Never send a second hardware release command as a UI retry.
- Do not clear hardware quarantine automatically from frontend code.
- A QR/payment screen must preserve scannability over decorative animation.
- Touch targets must remain usable on the physical kiosk WebView at its real viewport and scaling.

## 13. CONFLICT RULE
When implementation, old mockup, CSS, branch code or prior conversation conflicts with this document, this document wins unless a newer explicit user-approved source-of-truth revision supersedes it.
