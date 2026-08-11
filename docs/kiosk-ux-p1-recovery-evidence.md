# Chargeurs.ch — P1 Kiosk UX Recovery Evidence

Owner: AGENT 4 — Chargeurs Kiosk UX  
PR: #80 `feat(kiosk-ux): P1 recovery unify transactional journey`

## Before — field evidence

Sources: physical kiosk photos supplied by Gaëtan on 2026-08-11 plus direct inspection of the production route and all kiosk render states.

Observed on the real landscape panel:

- marketing headline dominated the action hierarchy;
- Express / Client / Pass-offers competed visually;
- selection cards were visually weak and the main action felt detached;
- pricing confirmation left a large unused visual field and did not feel transactional;
- `Tarification indisponible` left a visually prominent disabled rental CTA;
- utility controls and payment reassurance consumed too much attention;
- hardware/ejection guidance did not feel physical enough;
- overall visual quality was perceived as prototype-like;
- visual language changed substantially between home, inner kiosk, payment, hardware and return states.

The screen-by-screen baseline was committed before the recovery implementation in `docs/kiosk-ux-p1-recovery-audit.md`.

## Complete screen coverage

The recovery now covers every kiosk state that AGENT 4 owns or presents:

1. boot/loading;
2. home;
3. Client pairing QR;
4. Client connected;
5. battery selection;
6. pricing confirmation;
7. starting / payment preparation;
8. payment QR;
9. payment confirmed / hardware wait;
10. release / physical slot guidance;
11. battery ready / active rental;
12. payment expiry;
13. generic error;
14. support-required state;
15. unknown/invalid station;
16. offline/update banners;
17. inactivity timeout surface;
18. help modal;
19. return detected;
20. return price calculation;
21. return settlement in progress;
22. return completed;
23. return financial-support state;
24. standby/advertising transition boundary (verified only; Ads engine/content is not modified by AGENT 4).

## After — implementation evidence

### Home / decision hierarchy

`kiosk-production-physical-director-v2.css` rebuilds the physical 1366×768 composition:

- only Express and Client remain primary journey choices;
- Pass/offers is removed from primary competition;
- the two journeys occupy the usable decision surface;
- payment marks become quiet reassurance;
- the station is a product cue rather than the dominant action.

### Battery selection

- full tactical workspace rather than centered loose cards;
- 2×2 slot grid matches the physical four-slot mental model;
- selected battery is unmistakable;
- Express selection uses green, Client selection uses blue;
- a dedicated right-side action rail carries the next action;
- touch targets and tap feedback are hardened for the real panel.

### Pricing confirmation

- no empty visual ocean;
- selected slot and rate become the central decision card;
- a dedicated confirmation rail owns the next action;
- Express / Client CTA color remains journey-aware;
- pricing failure no longer leaves the disabled primary rental CTA visually dominant.

### Member QR / connected

`kiosk-production-screen-director-v3.css` makes the pairing QR the dominant object, reduces competing copy and turns the connected state into one confirmation plus one clear action.

### Starting / payment

- `starting` is an explicit handoff card instead of a dead spinner gap;
- payment QR becomes the dominant object;
- method/reassurance content is visually secondary;
- progress remains visible and coherent through the handoff.

### Payment-confirmed / hardware wait

- station/slot scene is the hero;
- copy explains the physical wait;
- indefinite movement indicates waiting only, never success;
- no animation timer advances business state.

### Hardware 2.5D

`kiosk-production-hardware-2p5d.css` adds physical depth without WebGL cost:

- cabinet faceplate depth / side profile / product-lighting cues;
- waiting state keeps the battery visually seated;
- only canonical `active` visually advances the battery outward;
- therefore visual extraction cannot precede server-confirmed readiness.

### Battery ready

- `Prenez votre batterie` and the slot dominate;
- celebratory treatment is secondary to the physical instruction;
- canonical success remains the only trigger;
- auto-home status remains visible.

### Error / expired / support

- one human message and one safe next action dominate;
- technical references are demoted;
- cinematic intensity is intentionally reduced;
- progress position is retained instead of disappearing.

### Return

- return detected is immediate and calm;
- final amount / completion dominate before accounting detail;
- dense financial fields are visually secondary;
- completed state receives a distinct success treatment;
- support state clearly separates `battery safely returned` from `financial verification continuing`.

### Help / timeout / connectivity

- help is a touch-first utility sheet;
- inactivity controls are compact, consistent and non-destructive;
- offline/update banners remain visible but do not compete with the core action.

### Standby / Ads boundary

Direct inspection of `KioskAdvertisingLayer.tsx` confirms:

- screensaver activates only on `home`;
- any transactional scene disables it;
- modal/return overlays disable it;
- pointer/touch/key activity exits screensaver immediately;
- Ads telemetry/cache failures are isolated from kiosk rental UX.

AGENT 4 does not modify Advertising engine/content; this preserves `Advertising failure ≠ Kiosk failure`.

## Journey continuity / cinematic system

`KioskV3JourneyChrome.tsx` explicitly recognizes `starting`, `expired`, `error`, `support`, `return` and preserves the last transactional step through transient states.

`KioskV3CinematicDirector.tsx` + `kiosk-production-cinematic-director.css` provide scene-aware visual energy:

- Express green / Client blue;
- controlled transition light sweeps;
- slot-directed energy during hardware wait;
- one-shot success bloom only after canonical `active`;
- calmer return resolution;
- lower visual intensity in expired/error/support;
- reduced-motion support.

The visual direction is specified in `docs/chargeurs-cinematic-kiosk-direction.md`.

## Automated evidence

Current complete head validated: `2af7593b7800076b666a294a8b0b5909e546887a`.

GitHub Actions run `31480379799` — **Kiosk UX physical QA: SUCCESS**

- install dependencies: success;
- Agent 4 typecheck surface: success;
- `src/test/kioskUxRecovery.test.ts`: success;
- production build: success.

GitHub Actions run `31480379756` — **Chargeurs Ads checks: SUCCESS**.

## Vercel / visual proof status

Vercel Preview is working again for PR #80, but the latest observed `READY` preview currently points to commit `a0b44361464ec62ebd2b7efe48f4e5400f1e39ba` (`direct every remaining kiosk screen`).

That preview does **not** yet include the two later commits that load the final screen director and hardware 2.5D layer. Therefore AGENT 4 does not claim final visual proof for head `2af7593...` until Vercel produces a `READY` deployment for that SHA (or a descendant containing it).

## Required physical after-proof

AGENT 8 / integration QA should validate on a 1366×768-class kiosk panel and capture at minimum:

1. home;
2. Client pairing QR;
3. Client connected;
4. Express selection;
5. Client selection;
6. pricing confirmation with valid quote;
7. pricing-unavailable recovery;
8. starting;
9. payment QR;
10. payment confirmed / hardware wait;
11. canonical battery-ready state;
12. expired;
13. error/support;
14. help;
15. timeout;
16. return detected;
17. return calculated/settling;
18. return completed;
19. return financial-support state;
20. screensaver wake transition.

Acceptance observation distance: approximately 1.5–2 metres for primary CTA/action comprehension.

## Known cross-domain blocker

Physical Client test on DTA21269 currently fails at pricing despite a valid member pairing and valid member pricing snapshot. RCA is tracked in issue #85 and must not be hidden by UX.

## Supporting motion handoff

AGENT 6 support task: issue #82. No implementation handoff had been posted at the time of this evidence update; AGENT 4 therefore implemented a lightweight 2.5D hardware presentation without waiting, while preserving AGENT 6 as optional support for future richer product assets/motion studies.
