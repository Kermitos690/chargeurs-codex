# Chargeurs.ch — Cinematic Premium Kiosk UX Direction

Owner: AGENT 4 — Chargeurs Kiosk UX  
Supporting motion / 2.5D / 3D: AGENT 6  
Status: execution specification for P1 Kiosk UX Recovery

## North star

The kiosk must feel like a premium brand film that happens to be an extremely clear machine interface.

Reference quality bar:

- emotional impact and product staging associated with top-tier consumer advertising;
- information hierarchy and restraint associated with premium hardware interfaces;
- trust and state clarity expected from fintech;
- recognisable Chargeurs.ch identity: Swiss, electric, precise, fast.

This is not permission to add visual noise. The target is **80% control / 20% spectacle**.

## Non-negotiable interaction rule

At every transactional moment the user must understand within ~2 seconds:

1. where they are;
2. what they should do now;
3. what the machine is doing;
4. what will happen next.

Cinematic effects may reinforce those answers. They may never replace them.

## Ownership boundary

### AGENT 4 owns

- journey hierarchy;
- CTA priority;
- touch affordance;
- state presentation;
- scene transitions;
- visual semantics of Express green / Client blue;
- accessibility and reduced motion;
- integration of cinematic layers into the kiosk;
- final acceptance on the physical 16:9 display.

### AGENT 6 may support

- 2.5D/3D station modelling;
- product-lighting studies;
- premium motion choreography;
- shader/WebGL prototypes that degrade safely;
- texture, depth and particle studies;
- hero product animations.

AGENT 6 does not own navigation, CTA hierarchy, state semantics or success timing.

## Absolute safety constraints

Cinematic code is presentation-only.

It must never:

- create payment success;
- infer payment completion from elapsed time;
- fire rental/session APIs;
- send hardware commands;
- infer an ejection from an animation;
- infer a return from an animation;
- change pricing or payment semantics;
- block the kiosk if an effect fails.

If the server remains in `ejecting`, the visual may show energy/focus/waiting, but not a completed battery extraction.

## Visual grammar

### Base world

- near-black / midnight blue physical environment;
- subtle volumetric depth;
- controlled vignette;
- faint floor reflection / pedestal glow;
- restrained particles that imply energy rather than confetti;
- bright typography with high contrast and minimal text.

### Express world — green

Meaning: speed, immediacy, no-account rental.

- primary energy: electric lime / clean green;
- motion: quicker and more directional;
- CTA: clear, assertive, high contrast;
- glow: concentrated around the action, not the whole screen.

### Client world — blue

Meaning: membership, account, benefits, premium continuity.

- primary energy: electric blue / cyan;
- motion: smoother, deeper, more composed;
- CTA: premium blue, high confidence;
- glow: layered depth and controlled rim light.

### Success green

Success is not the same as Express green. It is a semantic confirmation tone used only after canonical confirmation. It should feel warmer and calmer than the Express action color.

## Motion grammar

### Timing bands

- touch feedback: 90–140 ms;
- CTA confirmation / selection settle: 180–280 ms;
- scene transition: 260–480 ms;
- cinematic light sweep on a major state transition: 450–900 ms;
- ambient breathing: 4–10 s;
- hardware waiting motion: continuous but non-progressive unless real progress is known.

### Easing

- taps: fast ease-out;
- scene entrances: cubic-bezier(.2,.8,.2,1);
- product float / ambient: symmetric ease-in-out;
- success: spring may be used only for decorative confirmation, never for state timing.

### Motion hierarchy

Only one motion may be dominant at a time.

Examples:

- Home: slow product hero + subtle atmospheric movement.
- Payment QR: QR is static; only a restrained halo breathes.
- Hardware wait: slot focus / energy path is dominant.
- Battery ready: one decisive success sweep, then mostly still.
- Return complete: calm resolution, not another explosion.

## Scene choreography

### 00 — Standby / advertising

Purpose: attract from a few metres away without looking like the transaction has already started.

- advertising may own the visual surface only while idle;
- one-tap wake must be immediate;
- transition from ad to home uses a fast dark-to-brand reveal;
- no advertising chrome survives inside payment/rental/return scenes.

### 01 — Home

Purpose: decision in under 2 seconds.

Composition:

- two dominant touch surfaces: Express / Client;
- station/product hero to the right;
- very short title;
- Pass/offers and payment marks demoted to reassurance.

Cinematic:

- soft horizon glow;
- product rim light;
- occasional energy sweep behind the two choices;
- Express card emits a controlled green response on tap;
- Client card emits a controlled blue response on tap.

Never: three equal product cards, marketing copy dominating the screen, constant fireworks.

### 02 — Member QR

Purpose: scan immediately.

- QR is the dominant object;
- copy becomes a three-step instruction at most;
- blue halo breathes slowly;
- tiny light sweep may cross the QR frame but never the QR modules themselves;
- cancel remains obvious and safe.

### 03 — Member recognised

Purpose: reassure then continue.

- one elegant confirmation;
- compact benefit strip;
- one dominant blue CTA;
- short blue energy convergence into the CTA.

### 04 — Battery selection

Purpose: select one physical slot quickly.

- physical 1 | 3 / 2 | 4 relationship remains authoritative;
- selected slot has one dominant rim and depth cue;
- non-selected slots recede;
- tap response is immediate;
- CTA remains stable and strongly coloured by journey.

Cinematic effect must reinforce selection, not animate every card simultaneously.

### 05 — Price confirmation

Purpose: approve the commercial decision.

- selected slot;
- hourly price / period;
- guarantee;
- one dominant continue CTA.

Cinematic:

- restrained background;
- amount appears with a short clean reveal;
- no distraction from the decision.

### 06 — Payment QR

Purpose: pay.

- `Scannez pour payer` dominant;
- QR large and stable;
- payment marks secondary;
- timer readable but not alarming.

Cinematic:

- controlled cyan/green halo depending on journey;
- subtle energy flow from phone/QR side toward the system;
- no fake progress bar.

### 07 — Payment confirmed

Purpose: emotional transition from digital payment to physical machine action.

This is a hero moment.

Sequence, driven by canonical state transition into the hardware-wait scene:

1. short confirmation pulse;
2. screen lighting contracts toward the physical station representation;
3. energy path moves toward the selected slot;
4. copy changes to hardware guidance.

The effect must feel like the machine is waking up for this user.

### 08 — Hardware wait / ejection preparation

Purpose: make waiting understandable.

- active slot is the visual hero;
- other slots dim;
- light travels toward the selected compartment;
- copy: payment confirmed + explicit hardware status + look at slot X;
- no completed extraction motion until canonical release/active state.

If hardware takes longer, ambient waiting can continue indefinitely without implying percent completion.

### 09 — Battery ready

Purpose: physically take the battery now.

Hero message:

`PRENEZ VOTRE BATTERIE`

Secondary:

`SLOT X` + physical position cue.

Cinematic:

- one decisive bright sweep;
- success ring settles;
- active slot remains illuminated;
- auto-home timer becomes a subtle visible depletion rail.

No marketing paragraph competes with the instruction.

### 10 — Return detected

Purpose: reassure that the physical return succeeded.

- large `Retour détecté`;
- physical confirmation is green/cyan and calm;
- next status: exact price calculation / settlement.

Cinematic:

- energy retracts inward rather than exploding outward;
- soft closing pulse.

### 11 — Return settlement

Purpose: explain that the system is finishing.

- final calculated amount can be prominent;
- 2–3 essential facts only while waiting;
- accounting details remain secondary.

### 12 — Rental complete

Purpose: close with confidence.

- final amount;
- duration;
- returned slot;
- dominant finish/home action;
- optional compact receipt data.

Cinematic:

- calm success glow;
- no confetti;
- graceful fade back to home.

### 13 — Error / support / timeout

Purpose: preserve confidence under failure.

- human explanation first;
- safe next action second;
- technical reference demoted;
- red is reserved for errors requiring intervention;
- amber for recoverable/support states.

Cinematic is deliberately reduced in failures so the safe action wins.

## 2.5D / 3D station requirements

The station should become a recognisable product object, not a generic four-box diagram.

Target qualities:

- front face proportions close to the real four-slot cabinet;
- correct physical slot topology `1 | 3 / 2 | 4` wherever location guidance is shown;
- believable materials: dark shell, illuminated slot edges, soft screen glass;
- perspective subtle enough to preserve spatial mapping;
- dynamic light concentrated on the selected slot;
- battery body may translate outward only in a server-confirmed ready/active scene.

Progressive enhancement order:

1. high-quality DOM/SVG 2.5D — mandatory fallback;
2. optional WebGL/Three.js product hero if performance is proven;
3. if GPU/runtime/WebGL fails, DOM/SVG stays fully functional and visually premium.

## Performance budget

The embedded kiosk must never trade transactional reliability for spectacle.

Guidelines:

- no large video background inside transactional states;
- avoid continuous heavy blur layers above ~4 full-screen surfaces;
- prefer transforms/opacity for animation;
- keep DOM particle count low;
- WebGL must be lazy and fail-safe;
- target stable motion on the physical kiosk, not desktop benchmark hardware;
- reduced-motion preference disables non-essential scene motion.

## QA acceptance

A scene is not accepted because it looks good in a browser screenshot.

Physical acceptance requires:

- 1366×768-class panel test;
- readability at ~1.5–2 m;
- primary CTA obvious in <2 s;
- no clipped text;
- no element under bezel / browser chrome;
- tap feedback visible;
- state transition aligned with canonical server state;
- no animation creates an impossible physical story;
- Express and Client identity remains clear;
- return and failure states remain calmer than promotional scenes.

## Definition of “wow”

The user should feel:

- the machine noticed their action;
- the system is alive and responsive;
- the physical battery is the hero product;
- every light/motion cue points toward the next correct action;
- the kiosk feels deliberately designed rather than assembled from components.

The user should never have to ask: `où est-ce que je clique ?`.
