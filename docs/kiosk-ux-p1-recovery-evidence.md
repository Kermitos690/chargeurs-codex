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

The recovery now covers the complete kiosk presentation surface, including public, safety and hidden operator states:

1. `/kiosk` PWA boot / fallback route;
2. V2/V3 boot/loading;
3. home;
4. Client pairing QR;
5. Client pairing error/retry;
6. Client connected;
7. battery selection;
8. no-rentable-battery state;
9. pricing confirmation;
10. persistent pricing-unavailable recovery;
11. starting / payment preparation;
12. payment QR;
13. payment cancellation error;
14. payment confirmed / hardware wait;
15. release / physical slot guidance;
16. canonical battery-ready / active rental;
17. payment expiry;
18. generic error;
19. support-required state;
20. unknown/invalid station;
21. station-lock mismatch;
22. operational quarantine / maintenance guard;
23. offline/update banners;
24. inactivity timeout;
25. contextual help;
26. offers-launcher isolation from the premium journey;
27. return detected;
28. return price calculation;
29. return settlement in progress;
30. return completed;
31. return financial-support state;
32. standby/advertising transition boundary;
33. hidden operator diagnostics console;
34. FR/EN/DE presentation guard;
35. reduced-motion / touch-feedback behavior.

## Field-driven recovery

### Home

`kiosk-production-physical-director-v2.css` rebuilds the real 1366×768 composition:

- only Express and Client remain primary decisions;
- Pass/offers is removed from primary competition and from the V3 home chrome DOM;
- the two journeys own the usable touch surface;
- payment marks become quiet reassurance;
- the station becomes a product cue rather than a competing action.

`KioskOffersLauncher.tsx` is suppressed during V3 boot/home/member/connected and during the inner transaction, so a global purple offer control cannot reappear and compete with the premium journey.

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

`kiosk-production-screen-director-v3.css` makes pairing scan-first, reduces competing copy and turns the connected state into one confirmation plus one dominant action. Pairing failure/retry receives its own deliberate recovery state.

### Starting / payment

- `starting` becomes an explicit handoff instead of a dead spinner gap;
- payment QR is the dominant object;
- methods/reassurance are secondary;
- progress remains coherent through handoff, expiry and recoverable failures;
- payment cancellation failure is visible but cannot compete with the QR.

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
- visual extraction therefore cannot precede server-confirmed readiness;
- physical map remains `1 | 3 / 2 | 4`.

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
- support/error occurring during a transaction preserves the real last transactional step;
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

- help remains content-owned by `KioskHelpCenter`, while `KioskHelpLauncher` derives a presentation context from the current scene;
- the relevant FAQ topic is promoted for rent, price, payment, release or return;
- inactivity controls are compact and non-destructive;
- `KioskV3TouchFeedback.tsx` paints a pointer-free green/blue/neutral pulse on enabled kiosk buttons, including global Help/OperationalGuard overlays;
- reduced-motion disables decorative feedback.

### Hidden operator diagnostics

`KioskDiagnostics.tsx` is now a true 16:9 maintenance console rather than a narrow mobile card:

- system/connectivity evidence and local tools are separated into two columns;
- existing credential masking and security rules are preserved;
- no new hardware, payment or rental action is introduced;
- existing relock/update/fullscreen actions retain their original semantics.

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

Current validated head before this evidence update: `5c910a102d241ad648fc56e9944ee9e18c22ca1a`.

GitHub Actions run `31483263735` — **Kiosk UX physical QA: SUCCESS**

- dependencies: success;
- Agent 4 surface typecheck: success;
- `src/test/kioskUxRecovery.test.ts`: success;
- production build: success.

GitHub Actions run `31483263797` — **Chargeurs Ads checks: SUCCESS**.

Changed surface remains UX/docs/tests/CI only; no pricing engine, Stripe semantics, rental state machine, return business logic, inventory or hardware command code is modified by #80.

## Vercel preview evidence

Latest observed READY PR preview:

- deployment `dpl_9BtCcTPqiQapsRP5pRacv6pqUn7Q`;
- commit `b72bbaa7de78f30407cb48fdbecc6b6a8d1f362b`;
- state `READY`;
- branch `agent/kiosk-ux/p1-recovery`.

The READY preview contains the major physical layouts, complete screen director, pricing recovery, contextual help, fallback route, station mismatch styling, edge-state styling and hardware 2.5D. The current head adds later control hardening, diagnostics layout, launcher isolation, tests and CI coverage.

Vercel freshness remains separate from code validity; GitHub production build for the current validated head is green. The preview is protected by SSO, so AGENT 4 does not claim a connector-generated after-screenshot.

## Required physical after-proof

AGENT 8 / integration QA should validate on a 1366×768-class kiosk panel and capture at minimum:

1. `/kiosk` boot/fallback;
2. V3 boot;
3. home;
4. Express tap/identity;
5. Client tap/identity;
6. Client pairing QR;
7. pairing error/retry;
8. Client connected;
9. Express selection;
10. Client selection;
11. no-battery state;
12. pricing confirmation with valid quote;
13. pricing-unavailable recovery + retry;
14. starting;
15. payment QR;
16. payment cancellation error;
17. payment confirmed / hardware wait;
18. canonical battery-ready state;
19. expired;
20. generic error/support;
21. invalid/unknown station;
22. operational quarantine;
23. station mismatch;
24. offline/update banner layout;
25. contextual help from pricing/payment/release/return;
26. inactivity timeout;
27. return detected;
28. return calculated/settling;
29. return completed;
30. return financial-support state;
31. screensaver wake transition;
32. FR/EN/DE spot-checks;
33. reduced-motion spot-check;
34. hidden operator diagnostics at 1366×768;
35. standalone safety screen with no bogus journey rail.

Acceptance observation distance: approximately 1.5–2 metres for primary action comprehension.

## Known cross-domain blocker

Physical Client test on DTA21269 currently fails at pricing despite a valid claimed member pairing and valid member pricing snapshot. RCA is issue #85 and must not be hidden by UX.

## Integration gate

Authoritative order from Agent 0 remains:

`#77 MEMBER PRICING → #72 RETURN/SETTLEMENT SAFETY → #80 KIOSK UX → PHYSICAL E2E QA → RELEASE READINESS`

PR #80 therefore remains intentionally unmerged until upstream gates and physical QA are satisfied.

## Supporting motion handoff

AGENT 6 support task: issue #82. Agent 4 delivered the lightweight 2.5D baseline without waiting, while keeping Agent 6 available for richer future product assets/motion studies.
