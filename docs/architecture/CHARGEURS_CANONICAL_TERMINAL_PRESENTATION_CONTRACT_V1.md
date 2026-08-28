# CHARGEURS CANONICAL TERMINAL + PRESENTATION CONTRACT V1

Owner: **AGENT 1 — Chargeurs Control Center / Product Architecture**  
Program: **#166 — First complete TEST milestone**  
Integration gate: **#146**  
Base audited: `main@703decf67504a466ac63b19e9933fc512e134ef3`  
Status: **ARCHITECTURE DECIDED / IMPLEMENTATION CHANGES REQUIRED / TEST RELEASE NOT YET ACCEPTED**

This document is the common product contract between:

- **AGENT 2 — Payment / Stripe Terminal backend**;
- **AGENT 4 — Android / kiosk / responsive presentation**;
- **AGENT 6 — 3D / motion / visual experience**.

It does **not** implement their features. It defines the state, ownership, presentation and safety interfaces that their implementations must converge on before Agent 8 may build the first #166 integrated TEST candidate.

---

## 1. AUDITED EXECUTION EVIDENCE

### Program #166
#166 requires one coherent TEST milestone across Android APK, Stripe Terminal backend, frontend, kiosk/tablet/mobile/web and DTA21269 physical readiness. It explicitly requires:

- QR Checkout preserved;
- automatic `QR_ONLY` when reader is unavailable;
- payment-rail exclusivity once one rail is engaged;
- one canonical state machine and presentation model;
- return-flow visuals without Protected Core semantic drift.

### Agent 4 — PR #167
Current implementation evidence:

- branch: `agent/kiosk-wisepad3-stripe-terminal-usb`;
- head: `51f3fdb175d29439ede0829c4d36ca855daa0a69`;
- PR: #167;
- Stripe Terminal Android SDK 5.7.0 added;
- staging TEST feature flag added;
- Android application lifecycle delegate added;
- WisePad USB VID/PID probe for `15a2:0101` added;
- safe WebView method `getPaymentReaderStatus()` added;
- production/release path intends Terminal TEST disabled.

Field evidence in #144 already proves DTA21269 Android enumerates the WisePad and that the supplier application currently owns USB permission. The currently installed Chargeurs APK does not yet contain Stripe Terminal USB support.

### Agent 2 — PR #168
Current implementation evidence:

- branch: `agent/backend/wisepad3-stripe-terminal-audit`;
- head: `01a00cdea3315e5bff2731a95543241f1504d48c`;
- PR: #168;
- TEST-only ConnectionToken action;
- server-owned Stripe Location / optional reader binding;
- server-owned PaymentIntent amount from the rental pricing/deposit snapshot;
- `card_present`, manual capture;
- deterministic Stripe idempotency;
- rental ↔ PaymentIntent ↔ station ↔ reader/location persistence;
- first-payment-rail claim;
- QR Checkout preserved and protected against a Terminal claim.

PR #168 explicitly says cancel/process/webhook/restart recovery beyond PaymentIntent creation remains a later increment.

### Agent 6 — #82
Current evidence:

- canonical branch exists: `agent/creative-3d/kiosk-v1`;
- current head: `9e62d7c0c7c77d1830cf1c04b766aaeb81b54812`;
- last commit records an execution stall;
- no open real-3D implementation PR was found during this review.

Therefore Agent 6 remains `EXECUTION_EVIDENCE_REQUIRED`. This contract defines the exact presentation input it must consume when execution resumes.

---

# 2. PRODUCT INVARIANT

There is **one product journey**, not a QR journey, a Terminal journey, a kiosk journey and a 3D journey.

Canonical architecture:

```text
AUTHORITATIVE DOMAIN STATE
  backend rental/payment/physical-return truth
             +
NATIVE CAPABILITY STATE
  Android reader lifecycle only
             |
             v
CANONICAL EXPERIENCE DERIVER
             |
             v
ONE PRESENTATION MODEL
             |
   +---------+---------+---------+---------+
   |         |         |         |         |
 kiosk    tablet     mobile      web      3D/motion
```

No renderer or native layer is allowed to create a second business state machine.

The following are **inputs**, not independent product truth:

- Android USB presence;
- Stripe SDK callback progress;
- QR redirect state;
- animation duration;
- DOM visibility;
- local timers;
- provider `status=2` without accepted physical evidence.

---

# 3. CANONICAL JOURNEY STATE MACHINE

The canonical experience state is a **derived product projection**. It never replaces the Protected Core rental state machine; it maps authoritative backend/native inputs into one stable vocabulary used by every surface.

```ts
export type ChargeursJourneyState =
  | "BOOTING"
  | "AUTH_REQUIRED"
  | "HOME"
  | "MEMBER_CONNECT"
  | "SELECTION"
  | "PRICING"
  | "PAYMENT_READY"
  | "PAYMENT_IN_PROGRESS"
  | "PAYMENT_CONFIRMED"
  | "HARDWARE_WAIT"
  | "RELEASE_CONFIRMED"
  | "ACTIVE_RENTAL"
  | "RETURN_GUIDANCE"
  | "RETURN_VALIDATING"
  | "RETURN_ACCEPTED"
  | "SETTLEMENT_PENDING"
  | "COMPLETED"
  | "RECOVERY"
  | "OFFLINE"
  | "ERROR"
  | "SUPPORT_REQUIRED";
```

## Required transition rules

### `BOOTING -> HOME`
Only after the kiosk/app identity required for the surface is usable. A stale Home must not paint before bootstrap/auth completion.

### `HOME -> SELECTION`
Customer starts Express or completes Member connection and reaches the same rental contract.

### `SELECTION -> PRICING`
Selected slot and canonical server quote are available.

### `PRICING -> PAYMENT_READY`
Rental session exists and is eligible for payment. **No payment rail has yet been claimed.**

This state is mandatory for #166. The current frontend does not have it: current `Kiosk.tsx` creates the rental session and immediately calls QR Checkout. That behavior must change before Terminal + QR can coexist coherently.

### `PAYMENT_READY -> PAYMENT_IN_PROGRESS`
A rail is locally selected and the backend rail claim is being established / has been established.

### `PAYMENT_IN_PROGRESS -> PAYMENT_CONFIRMED`
Only after the backend authoritative payment projection reaches the accepted paid/authorized state required by the existing rental engine.

A native Stripe SDK success callback alone cannot produce `PAYMENT_CONFIRMED`.

### `PAYMENT_CONFIRMED -> HARDWARE_WAIT`
Existing Protected Core may initiate ejection. Presentation may focus/illuminate the selected slot but must not visually show a battery as physically out.

### `HARDWARE_WAIT -> RELEASE_CONFIRMED`
Only after authoritative physical release evidence advances the rental to the canonical released/ejected/active threshold.

No timer, animation completion, Stripe callback or provider acknowledgement may manufacture this transition.

### `RELEASE_CONFIRMED -> ACTIVE_RENTAL`
Presentation transition only; does not cause rental mutation.

### Return path

```text
ACTIVE_RENTAL
   -> RETURN_GUIDANCE
   -> RETURN_VALIDATING
   -> RETURN_ACCEPTED
   -> SETTLEMENT_PENDING
   -> COMPLETED
```

`RETURN_ACCEPTED` requires the Protected Core invariant defined in the active return lane:

```text
EXACT CONTRACTUAL BATTERY + REAL BATTERY_IN + VALID CORRELATION
```

No physical evidence -> no accepted return -> no settlement-success presentation.

Wrong battery, ambiguous correlation or a multi-release anomaly enters `SUPPORT_REQUIRED` / `RECOVERY`, never `COMPLETED`.

---

# 4. CANONICAL READER STATE

The reader vocabulary must be identical in Android diagnostics, frontend presentation and QA evidence.

```ts
export type ReaderState =
  | "UNAVAILABLE"      // Terminal feature/runtime not available on this surface/build
  | "ABSENT"           // target WisePad not physically present
  | "DISCOVERING"
  | "CONNECTING"
  | "RECONNECTING"
  | "UPDATING"
  | "READY"
  | "BUSY"
  | "ERROR";
```

Optional diagnostic metadata may expose:

```ts
readerDiagnostic = {
  usbPresent,
  usbPermission,
  targetVid,
  targetPid,
  stripeReaderId,
  stripeLocationId,
  ownerConflict,
  errorCode
}
```

These diagnostic details do not create customer-visible states by themselves.

## Critical rule

**USB presence is not reader readiness.**

The following are not equivalent:

```text
READER_PRESENT != READY
USB permission != Stripe connected
Stripe connected != payment rail engaged
```

The target reader is considered `READY` only when the Stripe Terminal SDK has a usable connected reader under the expected TEST Location/reader contract and no blocking update/error/busy transition exists.

---

# 5. CANONICAL PAYMENT CAPABILITY + RAIL CONTRACT

The only product vocabulary is:

```ts
export type PaymentCapability =
  | "TERMINAL_AND_QR"
  | "QR_ONLY";

export type PaymentRail =
  | "NONE"
  | "TERMINAL"
  | "QR";

export type PaymentRailState =
  | "UNCLAIMED"
  | "CLAIMING"
  | "ENGAGED"
  | "PROCESSING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLING"
  | "CANCELLED"
  | "EXPIRED";
```

## Capability derivation

```text
reader_state == READY
AND surface supports native Terminal
AND TEST Terminal feature enabled
AND backend station binding enabled
=> TERMINAL_AND_QR

otherwise
=> QR_ONLY
```

`QR_ONLY` is a normal capability state, not an error.

## Customer behavior

### `TERMINAL_AND_QR`
- Terminal is primary visual action.
- QR Checkout is secondary/fallback.
- Both exist only while `PaymentRail == NONE`.

### `QR_ONLY`
- Terminal action is not rendered as a dead/disabled CTA.
- QR is presented cleanly as the available method.
- Rental eligibility is not reduced merely because Terminal is unavailable.

## Pre-engagement degradation
If reader goes `READY -> RECONNECTING|UPDATING|ABSENT|ERROR` while `PaymentRail == NONE`, capability becomes `QR_ONLY` immediately without kiosk restart.

## Rail engagement
Frontend may optimistically disable the competing CTA immediately after a tap, but **backend atomic claim is authoritative**.

After the backend has accepted a rail claim:

```text
PaymentRail == TERMINAL -> QR cannot start for that rental attempt
PaymentRail == QR       -> Terminal cannot start for that rental attempt
```

## Post-engagement degradation
If Terminal has already been claimed and the reader disconnects, **do not automatically start QR for the same rental session**.

The system must first follow the canonical Terminal cancel/recovery contract. Only a server-confirmed safe cancellation/release of the Terminal attempt may permit a new payment attempt according to Agent 2's Protected Core rules.

This prevents a reader failure from creating a hidden parallel QR charge.

---

# 6. PAYMENT SEQUENCE — TERMINAL

Canonical sequence:

```text
1. Backend creates canonical rental session + pricing snapshot
2. Presentation enters PAYMENT_READY
3. Reader model says READY => TERMINAL_AND_QR
4. User selects TERMINAL
5. Frontend locally locks competing action
6. Agent 2 backend atomically claims TERMINAL rail
7. Agent 2 creates/reuses canonical TEST PaymentIntent
8. Android Stripe Terminal SDK obtains ConnectionToken from Agent 2 backend
9. Android collects/processes card_present against that PaymentIntent
10. Android reports local SDK progress only
11. Backend Stripe reconciliation/webhook confirms authoritative payment state
12. Canonical projection enters PAYMENT_CONFIRMED
13. Existing Protected Core ejection path may continue
```

### ConnectionToken
Owned by Agent 2 backend, consumed by Android Stripe SDK.

- short-lived;
- TEST only for first milestone;
- never logged;
- never stored in presentation state;
- frontend/3D never consume it.

### PaymentIntent client secret
May cross the native boundary only as an ephemeral execution credential if required by the chosen implementation. It must never become durable presentation state, logs, localStorage or analytics payload.

### Payment confirmation
Only server reconciliation may unlock `PAYMENT_CONFIRMED -> HARDWARE_WAIT`.

---

# 7. PAYMENT SEQUENCE — QR

Canonical sequence:

```text
1. Backend creates canonical rental session + pricing snapshot
2. Presentation enters PAYMENT_READY
3. Capability is QR_ONLY or TERMINAL_AND_QR
4. User selects QR
5. Frontend locally locks competing action
6. Backend atomically claims QR rail
7. Existing Stripe Checkout is created/reused
8. Presentation renders QR
9. Backend payment projection confirms paid state
10. Canonical projection enters PAYMENT_CONFIRMED
11. Existing Protected Core ejection path may continue
```

QR Checkout remains a first-class rail, not a deprecated fallback implementation.

---

# 8. CANONICAL PRESENTATION MODEL

All visible clients consume one model shape.

```ts
export type ChargeursPresentationModel = {
  version: 1;

  surface: {
    kind: "KIOSK" | "TABLET" | "MOBILE" | "WEB";
    nativeBridge: boolean;
    viewportClass: "KIOSK_1280x720" | "TABLET" | "MOBILE" | "DESKTOP";
    reducedMotion: boolean;
    renderTier: "HIGH" | "MEDIUM" | "SAFE";
  };

  journey: {
    state: ChargeursJourneyState;
    previousState?: ChargeursJourneyState;
    recoverable: boolean;
    supportRequired: boolean;
    correlationId?: string;
  };

  station: {
    stationId?: string;
    online: boolean;
    selectedSlot?: number;
    slotTopology: "1|3/2|4" | "UNKNOWN";
  };

  pricing: {
    status: "UNKNOWN" | "READY" | "UNAVAILABLE";
    segment?: "guest" | "member";
    currency?: "CHF";
    serverQuoteOnly: true;
  };

  reader: {
    state: ReaderState;
    capability: PaymentCapability;
    safeMessageCode?: string;
  };

  payment: {
    rail: PaymentRail;
    railState: PaymentRailState;
    canChooseTerminal: boolean;
    canChooseQr: boolean;
    serverConfirmed: boolean;
  };

  hardware: {
    releaseState: "NONE" | "WAITING" | "PHYSICALLY_CONFIRMED" | "AMBIGUOUS" | "FAILED";
    expectedSlot?: number;
    confirmedSlot?: number;
    contractualBatteryId?: string;
  };

  return: {
    state: "NONE" | "GUIDANCE" | "VALIDATING" | "ACCEPTED" | "AMBIGUOUS" | "FAILED";
    physicalEvidenceAccepted: boolean;
    returnedSlot?: number;
  };

  visuals: {
    sceneCue:
      | "BOOT"
      | "HOME_IDLE"
      | "SLOT_FOCUS"
      | "PAYMENT_READY"
      | "TERMINAL_PROCESSING"
      | "QR_PROCESSING"
      | "PAYMENT_CONFIRMED"
      | "RELEASE_WAIT"
      | "RELEASE_CONFIRMED"
      | "ACTIVE"
      | "RETURN_GUIDANCE"
      | "RETURN_ACCEPTED"
      | "RECOVERY"
      | "ERROR"
      | "OFFLINE";
  };
};
```

No renderer may add business fields to this model.

---

# 9. AGENT OWNERSHIP BOUNDARIES

## AGENT 2 — Backend / Stripe / payment truth
Owns:

- ConnectionToken endpoint;
- TEST/LIVE enforcement;
- canonical Stripe Location/reader binding;
- PaymentIntent creation/reuse;
- canonical amount/currency source;
- payment rail atomic claim;
- idempotency;
- Terminal cancel/retry/recovery contract;
- Stripe webhook/reconciliation;
- backend payment projection consumed by the journey deriver;
- correlation IDs.

Must not own:

- USB discovery;
- Android reader lifecycle;
- kiosk layout;
- 3D state;
- pricing formula redesign;
- ejection/return redesign.

## AGENT 4 — Android + presentation integration
Owns:

- Stripe Terminal Android SDK lifecycle;
- USB identity/permission/reader discovery;
- connect/reconnect/detach/reboot/update behavior;
- safe native reader-state bridge;
- rail-selection UI and responsive presentation;
- canonical experience-state/presentation-model derivation in frontend;
- kiosk/tablet/mobile/web layouts consuming the same model.

Must not own:

- payment amount;
- PaymentIntent financial truth;
- Stripe reconciliation truth;
- rental/ejection/return mutation;
- 3D-specific scene implementation.

## AGENT 6 — 3D / motion renderer
Owns:

- real 3D station/powerbank assets;
- motion system;
- HIGH/MEDIUM/SAFE renderer implementations;
- visual response to `visuals.sceneCue` and safe model fields;
- reduced-motion/non-WebGL fallback parity;
- asset license/provenance and performance budget.

Must not:

- inspect Stripe SDK state directly;
- call payment endpoints;
- infer payment from QR visibility;
- infer release from animation duration;
- infer return from generic insertion animation;
- mutate navigation/state machine;
- read provider events directly.

## AGENT 8 — release consumer
Agent 8 receives owner-approved implementations only after this contract is respected and validates the exact combined SHA/build.

---

# 10. KIOSK / TABLET / MOBILE / WEB CONSISTENCY

The **state machine and model are identical**. Only rendering and capability differ.

## Physical native kiosk
- can reach `TERMINAL_AND_QR` when reader is truly `READY`;
- otherwise `QR_ONLY`;
- full slot/hardware/return visual guidance;
- HIGH/MEDIUM/SAFE chosen by physical performance gate.

## Tablet
- same model/state vocabulary;
- if running outside the native Terminal-capable wrapper: reader `UNAVAILABLE`, capability `QR_ONLY`;
- layout may reflow but transitions/actions retain the same semantics.

## Mobile
- same journey labels and server truth;
- reader `UNAVAILABLE` for this milestone;
- no fake Terminal control;
- mobile account/QR continuation must reflect the same session/payment state rather than inventing a parallel state machine.

## Web/desktop
- same model/state vocabulary;
- reader `UNAVAILABLE` unless an explicitly supported native bridge exists;
- responsive renderer only; no alternate financial logic.

Surface size must never decide payment or rental truth.

---

# 11. 3D / MOTION CONTRACT

Agent 6 receives **scene cues**, not business authority.

### Allowed before release confirmation
During `HARDWARE_WAIT`:

- selected-slot focus;
- LED glow;
- energy pulse toward the correct slot;
- mechanical anticipation without depicting the battery as out.

### Allowed after release confirmation
Only when `hardware.releaseState == PHYSICALLY_CONFIRMED`:

- battery extraction/out movement;
- slot-to-user motion cue;
- success scene.

### Return
During `RETURN_GUIDANCE`, visuals may show **where/how** to insert.

They must not show “return accepted” until:

```text
return.state == ACCEPTED
AND return.physicalEvidenceAccepted == true
```

Ambiguous/multi-release/wrong-battery states must remain visibly unresolved and must not be hidden by a generic green success animation.

---

# 12. COLLISIONS / INCOHERENCIES FOUND

## C1 — payment capability naming collision
Existing documents use:

- `TERMINAL_AND_QR | QR_ONLY` (#146/#166);
- `DUAL | QR_ONLY` (#144 execution instruction);
- PR #167 returns `TERMINAL_USB_TEST | QR_ONLY`.

**Decision:** only `TERMINAL_AND_QR | QR_ONLY` is canonical product vocabulary.

## C2 — reader-state collision
PR #167 currently exposes raw probe states such as `READER_PRESENT`, `USB_ABSENT`, `ERROR`, while #144 expects `UNAVAILABLE | CONNECTING | READY | BUSY | UPDATING | ERROR`.

**Decision:** raw USB probe remains diagnostics only. Customer/payment capability must be based on the canonical `ReaderState` and Stripe-connected `READY`, not USB presence.

## C3 — current QR auto-engagement blocks Terminal coexistence
Current `Kiosk.tsx` does:

```text
create rental session -> requestCheckout() immediately
```

Therefore QR becomes the implicit only rail before the customer can choose Terminal.

**Decision:** Agent 4 must introduce the canonical `PAYMENT_READY` state after rental-session creation and move QR Checkout creation behind explicit QR rail selection.

## C4 — current frontend has a second local payment state machine
Current local `Phase` includes `qr`, `waitpay`, `success`, while `kioskPaymentState.ts` independently maps backend rental states to these phases.

Adding Terminal-specific local phases in parallel would create a third state machine.

**Decision:** evolve toward one canonical journey/presentation deriver; Terminal must not be bolted on as an unrelated `terminalPhase` flow.

## C5 — PR #168 recovery incomplete
PR #168 currently implements ConnectionToken + PaymentIntent creation/claim, but states that cancel/process/webhook/restart recovery remains later.

#166 requires cancel/retry/timeout/recovery.

**Decision:** #168 is valid foundation evidence, but not yet sufficient for integrated TEST acceptance.

## C6 — Terminal rail claim failure semantics are not complete
PR #168 claims Terminal before PaymentIntent creation. If downstream Stripe creation fails, the contract must distinguish:

- no Stripe side effect, safe claim release/retry;
- uncertain Stripe side effect, reconciliation required;
- active PaymentIntent, Terminal remains authoritative.

**Decision:** no automatic QR fallback after a server Terminal claim until Agent 2 returns a server-confirmed safe cancellation/release state.

## C7 — supplier USB ownership
Field evidence says the supplier POS currently owns WisePad USB permission.

**Decision:** customer capability remains `QR_ONLY` while Chargeurs cannot establish Stripe `READY`. No code may automatically revoke/uninstall/disable supplier ownership. Ownership cutover is a controlled physical TEST step under Agent 8/Agent 0.

## C8 — 3D branch is stale / no implementation PR
Agent 6 branch head records an execution stall and predates current main significantly.

**Decision:** do not integrate 3D into #167/current kiosk files yet. Agent 6 must rebase/refresh its isolated prototype and implement against the presentation-model contract, not against old V3 DOM/classes.

## C9 — V5 presentation still wraps legacy adapter architecture
Current `KioskPremiumGateV3` still mounts V2 as an invisible business adapter plus multiple presentation directors/styles.

**Decision:** #166 work must not create another reader/payment/3D overlay owner. New Terminal/3D UI belongs in the canonical presentation-model owner under Agent 4.

## C10 — return success is externally protected
Field history proved a rental could previously complete before the contractual battery's real BATTERY_IN.

**Decision:** Terminal introduction and 3D work cannot create any alternate return completion signal. Protected return evidence remains independent of payment rail.

---

# 13. REQUIRED CHANGES BEFORE CONTRACT ACCEPTANCE

## AGENT 2 — PR #168
Required:

1. Standardize backend rail output to `NONE | TERMINAL | QR` and expose rail claim/progress through one server projection consumed by frontend.
2. Complete cancel/retry/timeout/restart/reconciliation semantics required by #166.
3. Define safe rail-claim release conditions when Terminal setup fails before any Stripe side effect.
4. Define uncertain-state reconciliation when Stripe side effect may have occurred.
5. Prove race tests:
   - Terminal claim vs simultaneous QR attempt;
   - QR claim vs simultaneous Terminal attempt;
   - repeated Terminal create;
   - restart with existing PI/claim.
6. Ensure authoritative `PAYMENT_CONFIRMED` is projected from server/Stripe reconciliation, never native callback alone.
7. Preserve return/settlement invariant and existing pricing rules.

Status after this review: **FOUNDATION_ACCEPTED / CONTRACT_CHANGES_REQUIRED / NOT_READY_FOR_INTEGRATED_TEST**.

## AGENT 4 — PR #167 + frontend lane
Required:

1. Replace product-facing `TERMINAL_USB_TEST` / `DUAL` vocabulary with `TERMINAL_AND_QR | QR_ONLY`.
2. Keep `READER_PRESENT`/`USB_ABSENT` as diagnostics only.
3. Implement the canonical reader lifecycle state and derive `READY` from Stripe Terminal connection, not VID/PID presence.
4. Expose safe reader model to frontend with no ConnectionToken/secret/payment amount.
5. Introduce `PAYMENT_READY` in the existing kiosk journey; do not create QR Checkout automatically immediately after rental-session creation.
6. Add explicit rail selection; local immediate lock + backend authoritative claim.
7. Do not auto-fallback from an **engaged** Terminal rail to QR without server cancellation/release.
8. Derive one `ChargeursPresentationModel`; do not create a parallel Terminal UI state machine.
9. Validate the same model on kiosk/tablet/mobile/web; surfaces may reflow, semantics may not diverge.
10. Preserve #102 native auth lifecycle and avoid native-file collisions when refreshing branch.

Status after this review: **ANDROID_FOUNDATION_ACCEPTED / PAYMENT-PRESENTATION_CONTRACT_CHANGES_REQUIRED / PHYSICAL_APK_TEST_REQUIRED**.

## AGENT 6 — #82
Required before production handoff:

1. Refresh/rebase isolated 3D branch from current accepted baseline.
2. Produce real implementation PR + license register.
3. Consume `ChargeursPresentationModel` / `visuals.sceneCue` only.
4. No DOM-sniffing or independent business state inference.
5. Implement HIGH/MEDIUM/SAFE with identical state contract.
6. Prove `HARDWARE_WAIT` does not depict a released battery.
7. Prove `RETURN_GUIDANCE` does not depict accepted return.
8. Physical Android WebView performance benchmark before integration.

Status after this review: **CONTRACT_DEFINED / EXECUTION_EVIDENCE_REQUIRED / NO_PRODUCTION_INTEGRATION**.

---

# 14. INTEGRATION ORDER FOR #166

```text
1. Agent 1 contract accepted (#146 / this artifact)
2. Agent 2 closes payment backend contract gaps
3. Agent 4 closes reader + PAYMENT_READY/presentation-model gaps
4. Agent 2 + Agent 4 contract tests against identical enum/schema
5. Agent 4 signed STAGING TEST APK
6. TEST reader ownership cutover under controlled physical procedure
7. Reader lifecycle validation: boot / absent / connect / update / ready / detach / replug / reboot
8. QR_ONLY + TERMINAL_AND_QR UI validation
9. Terminal TEST payment without battery ejection
10. QR TEST path regression
11. Cross-surface kiosk/tablet/mobile/web smoke
12. Agent 6 isolated renderer contract validation
13. Optional Agent 6 chosen tier integrated only after performance gate
14. Protected return visual matrix
15. Agent 8 creates one exact integrated release manifest
```

Agent 8 must not treat Vercel preview success as Android/Stripe/physical validation.

---

# 15. CONTRACT ACCEPTANCE MATRIX

| Contract | Agent 2 | Agent 4 | Agent 6 |
|---|---|---|---|
| One canonical journey state | provide server truth | derive/render | consume only |
| One presentation model | provide payment projection | owner/derive | consume |
| Reader lifecycle | no | owner | visual consumption only |
| `TERMINAL_AND_QR / QR_ONLY` | rail enforcement | capability/render | optional visual cue |
| First-rail-wins | authoritative | UI lock + server request | no role |
| Canonical amount | authoritative | display only | never consume for logic |
| Payment success | authoritative projection | render | render cue only |
| Hardware release | no new semantics | render server truth | animation after confirmation |
| Return acceptance | no alternate signal | render protected truth | animate only accepted truth |
| Surface responsiveness | API invariant | owner | renderer adaptation |
| TEST/LIVE | owner | obey flag | irrelevant |

---

# 16. FINAL ARCHITECTURE DECISION

The Agent 2 and Agent 4 foundations are real and directionally compatible, but **they are not yet contract-compatible enough to merge as a complete #166 milestone**.

The largest product blocker is not Stripe itself. It is that the current frontend still assumes:

```text
rental created -> QR Checkout immediately
```

while #166 now requires:

```text
rental created
-> PAYMENT_READY
-> choose TERMINAL or QR according to capability
-> backend first-rail claim
-> one authoritative payment confirmation
-> existing protected hardware/return journey
```

Agent 6 must then render this same model without owning it.

**Gate decision:**

`ACCEPT_FOUNDATIONS_WITH_REQUIRED_CHANGES / SINGLE_CONTRACT_DEFINED / INTEGRATED_TEST_BLOCKED UNTIL AGENT2+AGENT4 CONVERGE / AGENT6 EVIDENCE REQUIRED`
