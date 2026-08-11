# KIOSK TARGET ARCHITECTURE V4

Owner: AGENT 1 — Control Center
Status: ROUTED / ARTIFACT PLACEHOLDER — AGENT 1 MUST COMPLETE
Parent: #127 / #126

This file is reserved for the Agent 1 architecture deliverable. Agent 0 created the branch and placeholder only to materialize the handoff and prevent parallel architecture documents. Agent 0 does not define the architecture here.

Agent 1 must replace this placeholder with the required sections:

- CURRENT_OWNER_MAP
- TARGET_OWNER_MAP
- COMPONENT_CLASSIFICATION
- STATE_TO_PRESENTATION_CONTRACT
- LEGACY_RETIREMENT_ORDER
- CSS_RETIREMENT_PLAN
- NATIVE_BOOT_BOUNDARY
- AGENT4_BOUNDARY
- AGENT6_3D_BOUNDARY
- AGENT8_QA_HOOKS
- COLLISIONS
- RISKS
- NEXT_HANDOFFS

Mandatory classification scope:
- KioskPremiumGateV2
- KioskPremiumGateV3
- Kiosk.tsx
- KioskV3OwnedHome
- KioskV3Atmosphere
- KioskV3HomeChrome if reachable
- KioskV3CinematicDirector
- KioskV3JourneyChrome
- Help/FAQ owners/listeners
- Advertising layer
- return presentation
- auth guard
- timeout owner
- boot/loading/native bootstrap
- all kiosk CSS layers imported by KioskPremiumGateV3

Target invariant:

`CANONICAL KIOSK STATE MACHINE -> PRESENTATION MODEL -> ONE KIOSK UI`

No Protected Core semantics may be moved into the presentation layer.
