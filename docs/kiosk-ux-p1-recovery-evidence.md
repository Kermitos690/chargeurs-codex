# Chargeurs.ch — P1 Kiosk UX Recovery Evidence

Owner: AGENT 4 — Chargeurs Kiosk UX  
PR: #80 `feat(kiosk-ux): P1 cinematic recovery unify transactional journey`

## Before — field evidence

Sources: physical kiosk photos supplied by Gaëtan on 2026-08-11 plus direct inspection of every kiosk render state and global kiosk overlay.

Observed on the real landscape panel:

- marketing headline dominated the action hierarchy;
- Express / Client / Pass-offers competed visually;
- selection cards were visually weak and the primary action felt detached;
- pricing confirmation left a large unused visual field and did not feel transactional;
- `Tarification indisponible` left a visually dominant disabled rental CTA;
- utility controls and payment reassurance consumed too much attention;
- hardware/ejection guidance did not feel physical enough;
- overall quality felt prototype-like;
- visual language changed substantially between home, inner kiosk, payment, hardware and return states.

The screen-by-screen baseline was committed before implementation in `docs/kiosk-ux-p1-recovery-audit.md`.

## Complete screen coverage

The recovery now covers the complete public kiosk presentation surface:

1. `/kiosk` PWA boot / fallback route;
2. V2/V3 boot/loading;
3. home;
4. Client pairing QR;
5. Client connected;
6. battery selection;
7. pricing confirmation;
8. persistent pricing-unavailable recovery;
9. starting / payment preparation;
10. payment QR;
11. payment confirmed / hardware wait;
12. release / physical slot guidance;
13. canonical battery-ready / active rental;
14. payment expiry;
15. generic error;
16. support-required state;
17. unknown/invalid station;
18. station-lock mismatch;
19. operational quarantine / maintenance guard;
20. offline/update banners;
21. inactivity timeout;
22. contextual help;
23. offers launcher isolation from the premium journey;
24. return detected;
25. return price calculation;
26. return settlement in progress;
27. return completed;
28. return financial-support state;
29. standby/advertising transition boundary.

## Field-driven recovery

### Home

`kiosk-production-physical-director-v2.css` rebuilds the real 1366×768 composition:

- only Express and Client remain primary decisions;
- Pass/offers is removed from primary competition and from the V3 home chrome DOM;
- the two journeys own the usable touch surface;
- payment marks become quiet reassurance;
- the station becomes a product cue rather than a competing action.

`KioskOffersLauncher.tsx` is also suppressed during V3 boot/home/member/connected and during the inner transaction, so a global purple offer control cannot reappear and compete with the premium journey.

### Battery selection

- full tactical workspace rather than centered loose cards;
- 2×2 slot grid mirrors the four-slot physical mental model;
- selected battery is unmistakable;
- Express uses green, Client uses blue;
- a dedicated right action rail carries the next action;
- no-battery state has a deliberate recovery surface instead of a loose warning.

### Pricing confirmation

- no empty visual ocean;
- selected slot and rate become the central decision object;
- dedicated confirmation rail owns the next action;
- Express / Client CTA color remains journey-aware;
- pricing failure no longer leaves a dominant disabled rental CTA;
- `KioskV3PricingRecovery.tsx` waits for a persistent failure, then exposes a real FR/EN/DE retry control that delegates to the existing kiosk refresh/quote path and never invents a tariff.

### Client QR / connected

`kiosk-production-screen-director-v3.css` makes pairing scan-first, reduces competing copy and turns the connected state into one confirmation plus one dominant action.

### Starting / payment

- `starting` becomes an explicit handoff instead of a dead spinner gap;
- payment QR is the dominant object;
- methods/reassurance are secondary;
- progress remains coherent through handoff, expiry and recoverable failures.

### Payment-confirmed / hardware wait

- station/slot scene is the hero;
- copy explains the physical wait;
- indefinite movement means waiting only, never success;
- no animation timer advances business state.

### Hardware 2.5D

`kiosk-production-hardware-2p5d.css` adds cabinet depth and product lighting without WebGL cost:

- cabinet faceplate depth / side profile / light cues;
- canonical `release` keeps the battery visually seated;
- only canonical `active` advances the battery outward;
- visual extraction therefore cannot precede server-confirmed readiness.

### Battery ready

- `Prenez votre batterie` and slot dominate;
- celebration is secondary to the physical instruction;
- canonical success remains the only trigger;
- auto-home status remains visible.

### Error / expired / support / operational states

- one human message and one safe next action dominate;
- technical references are demoted;
- cinematic intensity is reduced;
- standalone quarantine/mismatch support screens do not show a fake transaction stepper;
- operational quarantine is classified as `support`, which also prevents Ads/screensaver from running behind it;
- station mismatch is styled as a full support state without changing station-lock semantics;
- fixed network/update banners reserve their own vertical space rather than covering the transaction rail.

### `/kiosk` fallback route

`KioskHome.tsx` was rebuilt without changing lock/navigation logic:

- premium secure boot state;
- FR/EN/DE unconfigured state;
- clear safety message that no rental/payment can start;
- no public technical `/kiosk/DTA...` instruction as the main content.

### Help / timeout / touch feedback

- help remains content-owned by `KioskHelpCenter`, but `KioskHelpLauncher` now derives a presentation context from the current scene;
- the relevant FAQ topic is promoted for rent, price, payment, release or return;
- inactivity controls are compact and non-destructive;
- `KioskV3TouchFeedback.tsx` paints a pointer-free green/blue/neutral pulse on enabled kiosk buttons, including global Help/OperationalGuard overlays;
- reduced-motion disables decorative feedback.

### Return

- return detected is immediate and calm;
- final amount/completion dominate before accounting detail;
- dense financial fields are visually secondary;
- completed state receives a distinct success treatment;
- support state separates `battery safely returned` from `financial verification continuing`.

`detectKioskReturnStage()` maps the actual overlay structure to settling/support/completed; tests cover each stage.

### Standby / Ads boundary

Direct inspection of `KioskAdvertisingLayer.tsx` confirms:

- screensaver activates only on `home`;
- any transactional/support/return scene disables it;
- modal/return overlays disable it;
- pointer/touch/key activity exits screensaver immediately;
- Ads telemetry/cache failures are isolated.

AGENT 4 does not modify Advertising engine/content; `Advertising failure ≠ Kiosk failure` remains intact.

## Journey continuity / cinematic system

`KioskV3JourneyChrome.tsx` recognizes outer boot, quarantine, station mismatch, starting, expired, error, support, return and the normal journey scenes. Transient states preserve the last valid transaction step; orphan support/error/loading states do not invent a stepper.

`KioskV3CinematicDirector.tsx` + `kiosk-production-cinematic-director.css` provide scene-aware energy:

- Express green / Client blue;
- controlled transition light sweeps;
- slot-directed energy during hardware wait;
- one-shot success bloom only after canonical `active`;
- calmer return resolution;
- lower intensity in expired/error/support;
- reduced-motion support.

Functional copy remains React/i18n-owned; `kiosk-production-i18n-guard.css` prevents CSS pseudo-copy from becoming the source of user instructions.

## Automated evidence

Current validated head: `ffcf92e76c64ed39db77794bc486cd636fb134ee`.

GitHub Actions run `31483039376` — **Kiosk UX physical QA: SUCCESS**

- dependencies: success;
- Agent 4 surface typecheck: success;
- `src/test/kioskUxRecovery.test.ts`: success;
- production build: success.

GitHub Actions run `31483039014` — **Chargeurs Ads checks: SUCCESS**.

Changed surface remains UX/docs/tests/CI only; no pricing engine, Stripe semantics, rental state machine, return business logic, inventory or hardware command code is modified by #80.

## Vercel preview evidence

Latest observed READY PR preview:

- deployment `dpl_9BtCcTPqiQapsRP5pRacv6pqUn7Q`;
- commit `b72bbaa7de78f30407cb48fdbecc6b6a8d1f362b`;
- state `READY`;
- branch `agent/kiosk-ux/p1-recovery`.

A direct compare from this READY preview commit to validated head `ffcf92e...` shows the head is 7 commits ahead and changes only:

- `KioskOffersLauncher.tsx` journey isolation/i18n cleanup;
- `KioskV3JourneyChrome.tsx` orphan-support/scene hardening;
- `KioskV3TouchFeedback.tsx` global-overlay pulse extension;
- scene tests;
- CI coverage.

The major field layouts, complete screen director, pricing recovery, contextual help, fallback route, station mismatch styling, edge-state styling and hardware 2.5D are already contained in the READY preview ancestor.

Vercel currently rejects a build for head `ffcf92e...` with `build-rate-limit`; this is a preview freshness issue, not a code/build failure. GitHub production build for the head is green.

The Vercel preview is protected by SSO; the available connector receives the SSO redirect, so AGENT 4 does not claim a connector-generated after-screenshot.

## Required physical after-proof

AGENT 8 / integration QA should validate on a 1366×768-class kiosk panel and capture at minimum:

1. `/kiosk` boot/fallback;
2. home;
3. Client pairing QR;
4. Client connected;
5. Express selection;
6. Client selection;
7. no-battery state;
8. pricing confirmation with valid quote;
9. pricing-unavailable recovery + retry;
10. starting;
11. payment QR;
12. payment cancellation error;
13. payment confirmed / hardware wait;
14. canonical battery-ready state;
15. expired;
16. error/support;
17. operational quarantine;
18. station mismatch;
19. offline/update banner layout;
20. contextual help from pricing/payment/release/return;
21. inactivity timeout;
22. return detected;
23. return calculated/settling;
24. return completed;
25. return financial-support state;
26. screensaver wake transition;
27. FR/EN/DE spot-checks;
28. reduced-motion spot-check.

Acceptance observation distance: approximately 1.5–2 metres for primary action comprehension.

## Known cross-domain blocker

Physical Client test on DTA21269 currently fails at pricing despite a valid claimed member pairing and valid member pricing snapshot. RCA is issue #85 and must not be hidden by UX.

## Integration gate

Authoritative order from Agent 0 remains:

`#77 MEMBER PRICING → #72 RETURN/SETTLEMENT SAFETY → #80 KIOSK UX → PHYSICAL E2E QA → RELEASE READINESS`

PR #80 therefore remains intentionally unmerged until upstream gates and physical QA are satisfied.

## Supporting motion handoff

AGENT 6 support task: issue #82. No implementation handoff had been posted when this evidence was finalized; Agent 4 therefore delivered the lightweight 2.5D baseline without waiting, while keeping Agent 6 available for richer future product assets/motion studies.
