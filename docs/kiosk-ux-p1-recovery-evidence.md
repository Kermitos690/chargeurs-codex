# Chargeurs.ch — P1 Kiosk UX Recovery Evidence

Owner: AGENT 4 — Chargeurs Kiosk UX  
PR: #80 `feat(kiosk-ux): P1 recovery unify transactional journey`

## Before — field evidence

Source: physical kiosk photo supplied by Gaëtan on 2026-08-11 before this recovery branch.

Observed on the real landscape panel:

- marketing headline dominated the action hierarchy;
- Express / Client / Pass-offers competed visually;
- the user reported difficulty knowing where to click;
- utility controls and payment reassurance consumed too much attention;
- overall visual quality was perceived as prototype-like;
- prior field feedback also identified weak feedback, underwhelming hardware/ejection motion and inconsistent journey presentation.

The full screen-by-screen baseline is committed first in `docs/kiosk-ux-p1-recovery-audit.md`.

## After — implementation evidence

The P1 recovery branch introduces the following verifiable presentation contracts:

### Decision hierarchy

- Home final presentation is explicitly constrained to two dominant choices: Express and Client.
- Pass/offers is demoted to a compact secondary utility.
- Header utilities are compacted.
- Payment marks become reassurance rather than primary content.

### Touch affordance

- Global kiosk buttons receive immediate active-state scale/brightness feedback.
- Visible focus treatment is normalized.
- Principal kiosk CTA dimensions are hardened for touch use.

### Journey continuity

`KioskV3JourneyChrome.tsx` now explicitly recognizes:

- `starting`;
- `expired`;
- `error`;
- `support`;
- `return`;

and preserves the last transactional position when a recoverable/transient state is shown.

### Express / Client identity

Progress and primary-action styling remains journey-aware:

- Express: green;
- Client: blue;
- canonical success: separate calmer success green.

### Payment / hardware guidance

- Payment QR is made the dominant object and reassurance content is demoted.
- Hardware-wait/release geometry expands to the physical viewport.
- The selected physical slot becomes the dominant visual target.
- Success is still triggered only by the canonical Kiosk state machine; the cinematic layer is pointer-free and state-read-only.

### Cinematic direction

`KioskV3CinematicDirector.tsx` + `kiosk-production-cinematic-director.css` add:

- scene-aware color grading;
- controlled transition light sweeps;
- Express/Client-aware energy palette;
- slot-directed energy focus during hardware wait;
- a one-shot success bloom only once the already-canonical `active` visual scene exists;
- calmer return resolution;
- deliberately reduced spectacle in error/support/expired scenes;
- reduced-motion compatibility.

The cinematic direction is specified in `docs/chargeurs-cinematic-kiosk-direction.md`.

### Presentation stack consolidation

`KioskPremiumGateV3.tsx` no longer loads the previous additive `physical-qa-pass2` and `home-decision-v3` layers. The final hierarchy is:

1. proven production base layers;
2. cinematic director decorative layer;
3. one final P1 recovery layout contract.

This reduces accidental cascade conflict between successive kiosk hotfix generations.

## Automated evidence

Head validated before this evidence note: `1f9fa519c054c3ecfb4fe5ae52ad5927a9868464`.

GitHub Actions run `31469421866` — **Kiosk UX physical QA: SUCCESS**

- install dependencies: success;
- Agent 4 typecheck surface: success;
- `src/test/kioskUxRecovery.test.ts`: success;
- production build: success.

GitHub Actions run `31469421903` — **Chargeurs Ads checks: SUCCESS**.

The recovery tests lock scene detection and Express/Client progress semantics, including transient states.

## Vercel / visual proof status

The latest cinematic head does **not** currently have a Vercel preview because the Git integration reports `build-rate-limit` on the latest PR head.

An earlier PR #80 preview exists only for the initial audit commit `a134d75...`; it is not valid evidence of the final cinematic implementation.

Therefore AGENT 4 explicitly does **not** claim a final after-screenshot yet.

## Required physical after-proof

AGENT 8 / integration QA should validate the PR on a preview or pilot deployment at minimum on a 1366×768-class kiosk panel and capture:

1. home;
2. Express battery selection;
3. pricing confirmation;
4. payment QR;
5. payment-confirmed / hardware wait;
6. canonical battery-ready state;
7. return detected;
8. return settling;
9. return completed;
10. error or expired recovery state.

Acceptance observation distance: approximately 1.5–2 metres for primary CTA / action comprehension.

## Supporting motion handoff

AGENT 6 support task: issue #82.

AGENT 6 is limited to premium station 2.5D/3D, product lighting and motion studies. AGENT 4 remains owner of journey semantics and final acceptance.
