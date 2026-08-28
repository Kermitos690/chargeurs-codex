# Agent 6 — Canonical WebGL Scene V1

Program: #166 — First complete TEST milestone
Agent: 6 — Motion / 3D / Visual Experience
Branch: `agent/creative-3d/canonical-webgl-v3`

## Purpose

This renderer is deliberately presentation-only. It consumes the canonical `visuals.sceneCue` vocabulary defined by Agent 1 and never reads rental, Stripe, USB, BATTERY_IN, pricing, settlement, DOM visibility or local timers to infer product truth.

The implementation is `src/components/kiosk/ChargeursEnergyScene.tsx`.

## Rendering tiers

### HIGH

Native browser WebGL 1 canvas. Original Chargeurs geometry is generated in code from cuboids representing the station body, slot aperture, powerbank and energy rail.

No texture upload, GLB/glTF model, shader package or 3D framework is required.

### MEDIUM

DOM/CSS 2.5D fallback using the same scene cue and the same physical composition. Intended for devices where WebGL is unavailable, unstable or fails the physical frame-pacing gate.

### SAFE

Static/reduced-motion DOM composition. No continuous animation is required. Semantics remain identical.

## Safety invariants

The renderer does not create or advance business state.

- `PAYMENT_CONFIRMED` does not cause ejection.
- `RELEASE_WAIT` must not depict the battery as physically released.
- `RELEASE_CONFIRMED` may depict a battery leaving the station only because the canonical presentation model already asserted physical release confirmation.
- `RETURN_GUIDANCE` visually guides insertion only; it must not depict an accepted return.
- `RETURN_ACCEPTED` is the first return cue allowed to visually seat/lock the battery as accepted.
- `RECOVERY`, `ERROR` and `OFFLINE` never display success styling.

Automated UI contract coverage is in `src/components/kiosk/ChargeursEnergyScene.test.tsx`.

## Asset / license register

| Item | Source | Author | License / commercial status | Included |
|---|---|---|---|---|
| Station cuboid geometry | Original code in repository | Chargeurs.ch / Agent 6 | Project-owned original work | Yes |
| Powerbank cuboid geometry | Original code in repository | Chargeurs.ch / Agent 6 | Project-owned original work | Yes |
| Energy rail geometry | Original code in repository | Chargeurs.ch / Agent 6 | Project-owned original work | Yes |
| Vertex shader | Original code in repository | Chargeurs.ch / Agent 6 | Project-owned original work | Yes |
| Fragment shader | Original code in repository | Chargeurs.ch / Agent 6 | Project-owned original work | Yes |
| External models / textures / HDRI / fonts | None | — | — | No |
| Three.js / React Three Fiber | None | — | — | No |

There is therefore no third-party 3D asset provenance ambiguity in V1.

## WebGL workload estimate

Current V1 HIGH scene renders four cuboids per frame:

- station body;
- slot aperture / energy block;
- powerbank;
- energy rail.

Each cuboid uses 12 triangles / 36 vertices. Total nominal geometry is approximately **48 triangles / 144 vertices per frame**.

There are no textures, shadow maps, post-processing passes, framebuffer effects, particles or model skinning.

Device pixel ratio is capped at **1.5** in HIGH mode to avoid unnecessary framebuffer cost on the 1280×720 kiosk.

At a physical 1280×720 viewport and DPR cap 1.5, the maximum canvas backing size is approximately 1920×1080. A rough color + depth framebuffer estimate is in the low tens of megabytes; exact driver allocation must be measured on DTA21269 rather than guessed from desktop behavior.

## Physical performance gate

Before Agent 8 accepts HIGH for the kiosk, measure on the real Android WebView:

1. 1280×720 kiosk viewport;
2. at least 60 seconds on `HOME_IDLE` / passive scene;
3. transitions through `PAYMENT_READY`, `RELEASE_WAIT`, `RELEASE_CONFIRMED`, `RETURN_GUIDANCE`, `RETURN_ACCEPTED` using presentation-model test fixtures only;
4. observe frame pacing, WebView process memory and thermal behavior;
5. repeat after kiosk has been running for at least 15 minutes.

Acceptance target:

- preferred: stable near 60 fps / ~16.7 ms frame budget;
- acceptable TEST fallback: stable 30 fps / ~33.3 ms with no input lag or thermal escalation;
- if sustained frame time exceeds 33.3 ms, WebGL context resets, WebView memory pressure appears, or touch responsiveness degrades, force `MEDIUM` or `SAFE` on that hardware profile.

No HIGH tier should be enabled in production solely because WebGL exists.

## Integration contract

Expected caller contract:

```tsx
<ChargeursEnergyScene
  sceneCue={presentation.visuals.sceneCue}
  renderTier={presentation.surface.renderTier}
  reducedMotion={presentation.surface.reducedMotion}
  slotNumber={presentation.hardware.expectedSlot ?? presentation.return.returnedSlot}
/>
```

The renderer must not translate backend state into `sceneCue`; that remains the canonical presentation-deriver responsibility owned outside Agent 6.

## Current limitation

The Agent 1 canonical presentation contract is still an open architecture PR at the time of this implementation. V1 therefore delivers the pure renderer and contract tests without inventing a temporary second state machine just to wire it into the current legacy kiosk phases.

The next integration step is to consume the real `ChargeursPresentationModel` once the shared deriver lands on an accepted integration branch.
