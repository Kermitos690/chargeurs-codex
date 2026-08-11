# Chargeurs.ch — P1 Kiosk UX Recovery Audit

Owner: AGENT 4 — Chargeurs Kiosk UX  
Dispatch: AGENT 0 — P1 KIOSK UX RECOVERY  
Baseline audited: production deployment on `main` commit `3a3aec5788639646fa512856a19254e0cb940491` plus current `main` presentation stack through `fc21cf9279c7d4607c6a11c09d69d2f24521d788`.

## Scope / hard boundaries

Presentation and interaction only. No pricing, Stripe, rental semantics, return semantics, hardware commands, inventory, or advertising engine changes. Any visual inconsistency caused by canonical backend state must be handed to AGENT 3 instead of being hidden by timers or synthetic success.

## Evidence used before modification

- Physical kiosk photo supplied by Gaëtan on 2026-08-11: home screen on the real landscape panel shows weak action hierarchy, three visually competing cards, oversized marketing headline and significant decorative surface.
- `KioskPremiumGateV3.tsx`: production route composes V2 state machine + V3 presentation + multiple successive CSS layers.
- `KioskPremiumGateV2.tsx`: home/member/connected wrapper.
- `Kiosk.tsx`: loading, selection, pricing, starting, payment QR, release/waiting hardware, active/success, expired, error/support.
- `KioskReturnOverlay.tsx`: return detected, settlement, support, completed summary.
- `KioskV3JourneyChrome.tsx`: current five-step journey rail.
- `KioskV3TimeoutOwnershipGuard.tsx`: inner kiosk owns timeout rules after V2 handoff.
- `PowerbankScene.tsx`: 4-slot selection and release visual.
- Current production CSS stack: cinematic, objects, scenes, return, help, hotfix, physical QA, physical QA pass 2, home decision V3.

## Cross-cutting finding

The dominant UX defect is not one bad page. The kiosk currently feels like several generations of UI layered together. States use different spacing systems, different feedback conventions, different motion intensity and different CTA rules. The user therefore has to re-learn the interface at each phase.

Recovery principle: every transactional state must answer, at a glance, four questions:

1. Where am I?
2. What should I do now?
3. What is the system doing?
4. What happens next?

## Screen-by-screen audit

| Screen / state | Existing strengths | P1 UX problem | Recovery requirement |
|---|---|---|---|
| Boot / loading | Safe neutral spinner | No context, no product identity, no explanation of what is loading | Brand + short status + non-blocking progress cue |
| Home | Express and Client journeys exist; green/blue semantics already defined | Physical photo shows 3 competing cards, oversized headline, weak CTA dominance; utilities compete for attention | Two dominant touch targets only; Express green and Client blue; Pass/offers secondary; reduce cognitive load |
| Member QR | QR is large and scan-safe; privacy copy exists | Large text blocks compete with QR; cancellation/timeout hierarchy not strong enough | QR is dominant object; 3-step instruction; clear cancel; clear temporary-session timer |
| Member connected | Benefits are visible; CTA exists | Confirmation + benefit grid + CTA create too many focal points | Confirmation first, one compact benefits strip, one dominant next action |
| Battery selection | Physical 1/3/2/4 mapping is preserved; selected slot is highlighted | Each card exposes label, visual, charge, progress, state, recommended, selected; too much simultaneous detail; CTA is detached below | Make slot cards instantly scannable; selected slot unmistakable; one fixed dominant CTA; large touch targets |
| Pricing confirmation | Price, period, guarantee and slot are visible | Looks like a data card rather than a decision; CTA text duplicates selection wording; back/continue hierarchy weak | One decision card: selected slot + hourly rate + guarantee; explicit `Continuer vers le paiement` |
| Starting | Safe server-owned transition | Generic spinner; journey rail can disappear because scene detection has no dedicated `starting` scene | Persistent progression; action-specific copy: `Préparation du paiement`; no dead visual gap |
| Payment QR | Large QR, payment methods, expiry, cancel | Too dense: price + title + body + methods + eligibility + QR + Stripe + timer + waiting + public code + cancel | QR and `Scannez pour payer` dominate; secondary reassurance collapsed; visible progress after successful tap/scan |
| Payment confirmed / hardware wait | Server state remains authoritative; slot animation already separated from success semantics | Indeterminate bar + many glows do not clearly explain hardware wait; user may not know whether to wait or touch | Strong `Paiement confirmé`; explicit hardware status; active slot locator; `Ne retirez rien avant l’ouverture` then `Regardez le slot X` |
| Ejection | Correct physical slot map; no timer-based success | Visual station is abstract and continuously animated, but physical action is not obvious enough at distance | Make active slot the hero; directional extraction cue only from verified state; stronger physical location label |
| Battery ready / active | Canonical state triggers success; slot number shown | Giant success/check treatment competes with the actual instruction; marketing copy adds noise; auto-home has no visible countdown | `PRENEZ LA BATTERIE — SLOT X` as dominant instruction; confirmation secondary; visible return-to-home countdown |
| Return detected | Return overlay correctly follows server summary | Good state semantics, but settling screen is generic and visually disconnected from the rest of the journey | Same visual language as transaction; large `Retour détecté`; explicit next step `Calcul du montant` |
| Return settlement | Financial data is server-confirmed | Too much detail for a public kiosk; user must parse a grid while waiting | During settlement show amount + 2–3 essential facts only; hide accounting detail until completion if needed |
| Return completed | Complete receipt data available | 10+ cells create admin/receipt density on a kiosk; primary success message loses hierarchy | Success first; final amount + duration + returned slot; optional compact receipt detail; dominant `Terminer` |
| Return support | Safe server-side continuation | Support wording is long and financial; user may think return failed | Lead with `Retour enregistré`; clearly separate `Votre batterie est bien rendue` from `Paiement en vérification` |
| Expired payment | Retry exists | Generic warning, progression disappears, no direct explanation of what expired | Explicit `QR expiré`; one primary `Générer un nouveau QR`; secondary home |
| Error | Retry/restart exists; correlation reference available | All errors look similar; technical metadata leaks into visual hierarchy; no clear safe-state explanation | Human category + next action; technical reference demoted; preserve fail-closed semantics |
| Timeout / inactivity | Inner state-aware timeout ownership is correct | Different timeout surfaces between V2 wrapper and inner kiosk; visibility and action placement inconsistent | One consistent countdown component; only shown where cancellation is safe; clear `Continuer`/`Accueil` ownership |
| Help | Large touch targets and modal styling exist | Help is generic and text-heavy; not contextual to current step | Contextual quick help: current step first, 3 concise actions, support secondary |
| Standby / ads | Advertising isolated from rental engine | Entry from ads/standby into transaction must remain visually immediate and fail-safe | One-tap wake/entry; no ad chrome during transactional phases; preserve Ads failure ≠ Kiosk failure |

## Specific verified implementation risks

1. `KioskV3JourneyChrome.detectScene()` has no explicit `starting`, `expired`, `error`, or `support` scene. The progress rail therefore disappears during important transitions and failures.
2. `Kiosk.tsx` uses a generic centered spinner for `starting`, disconnected from the current selected slot/payment context.
3. The payment screen contains too many equally weighted reassurance elements around the QR.
4. Success displays a large check plus a slot card plus marketing text, creating competing focal points when the only required action is to physically take the battery.
5. Return completion exposes a dense accounting grid that is correct but not kiosk-first.
6. The current presentation architecture is cascade-heavy: V2 base CSS plus V3 scene CSS plus hotfix and successive physical QA layers. Recovery should stop adding broad accidental overrides and introduce explicit recovery classes/components for key states.

## Acceptance targets for recovery

- Primary CTA identifiable in under 2 seconds from 1.5–2 m.
- Minimum practical touch target 56 px; principal actions >= 72 px where layout allows.
- Express path uses green for active/primary journey cues; Client path uses blue.
- One dominant action per screen.
- All taps provide immediate pressed/loading feedback.
- Progress rail remains coherent through selection → pricing → starting → payment → release → active → return.
- No visual state claims payment/ejection/return success before canonical state confirmation.
- No vertical clipping at 1366×768 class landscape panels.
- Reduced-motion mode remains usable.
- Error and timeout states always explain safe next action.

## Planned implementation sequence

1. Introduce recovery shell/tokens and robust scene detection for transient/error states.
2. Normalize CTA, tap feedback, progress and timeout surfaces.
3. Rework selection/pricing/starting/payment hierarchy.
4. Rework hardware wait/ejection/active hierarchy without touching state logic.
5. Rework return settling/completed/support presentation.
6. Add automated UX-structure tests + production build.
7. Produce before/after evidence, PR, then handoff to AGENT 8 for integration/release readiness.
