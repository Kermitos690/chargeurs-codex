# P0 — Single Premium runtime cleanup

## Field evidence
Physical kiosk restart shows multiple presentation layers appearing sequentially/overlapping: duplicated CTAs, oversized help/question affordances, close controls and legacy visual effects. The resulting runtime is not acceptable for pilot deployment.

## Root-risk confirmed in current `src/pages/Kiosk.tsx`
The kiosk page is a large monolithic runtime owning transaction state, PWA update logic, diagnostics, help overlays, refresh controls, pricing, slot selection, payment, release presentation and support/error states in one component. It also auto-applies a pending PWA update while idle/loading. This creates a high-risk surface for mixed runtime identities and layered UI if stale assets/service-worker state coexist with newer deployments.

## Non-negotiable target
Exactly one canonical Premium kiosk shell is rendered at any time.

### Keep
- Premium Home
- canonical journey: `Tarif -> Batterie -> Paiement -> Retour`
- server-owned Premium pricing
- one header
- one progress rail during transactional flow
- one payment surface
- one support surface
- one diagnostics surface, technician-only

### Remove / quarantine from customer runtime
- duplicate/legacy Home owners
- parallel help overlays or event-driven help surfaces
- duplicate refresh/update CTAs
- old visual-effect layers not explicitly part of Premium
- duplicate close buttons and floating emergency/help affordances on normal customer screens
- any second transaction presentation owner
- rescue CSS added solely to hide overlapping legacy components

## Runtime identity hardening
1. expose build SHA/version in diagnostics;
2. log exact WebView URL + service-worker asset revision;
3. do not hot-swap a service worker during an active customer flow;
4. on idle update, perform one controlled reload into a single asset revision;
5. clear obsolete cached kiosk assets during controlled update;
6. prove only one root kiosk application instance exists after cold boot.

## Acceptance
- cold boot DTA21269 shows one Premium Home only;
- no UI appears, disappears, then gets covered by another version;
- no giant `?`, stray `X`, duplicate CTA or overlapping controls;
- Express path visually stable through payment-ready;
- exact 1280x720 screenshots at Home / Tarif / Batterie / Paiement;
- runtime SHA + URL + asset revision recorded;
- no live charge or ejection required for this UI acceptance.
