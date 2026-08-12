# KIOSK TARGET ARCHITECTURE V4

Owner: **AGENT 1 — Chargeurs Control Center**  
Parent: **#127 / #126**  
Architecture snapshot reviewed against current `main` through `875390ebe5e0075fcb9b492d7f733664a71fab27` (2026-08-12).  
Status: **ARCHITECTURE DECIDED / IMPLEMENTATION HANDOFF REQUIRED / PHYSICAL VALIDATION REQUIRED**

## 0. Executive decision

Chargeurs.ch must converge to one kiosk architecture:

`NATIVE BOOT + AUTH -> CANONICAL KIOSK STATE -> PRESENTATION MODEL -> ONE VISIBLE KIOSK UI`

The present implementation is materially improved but remains transitional. Current `main` has already removed the legacy pre-React `#kiosk-premium-final` shell and introduced a neutral native preboot. That is accepted progress. However `KioskPremiumGateV3` still mounts `KioskPremiumGateV2` as a live adapter, `Kiosk.tsx` still owns substantial transactional presentation directly, many CSS director/recovery layers remain simultaneously imported, and `main.tsx` still initializes the imperative legacy Help controller.

The target is **not** a big-bang rewrite of the rental state machine. Business behavior that is already proven remains in place while presentation ownership is progressively reduced to one visible owner per state.

No pricing, Stripe, rental, ejection, return, settlement, Inventory or auth truth may be inferred from visual state, animation duration, DOM visibility or CSS.

---

# CURRENT_OWNER_MAP

## Native / pre-React boot

### `src/main.tsx`
Current responsibilities:
- detects kiosk/native surface;
- renders a neutral preboot for native Android;
- invokes `prepareNativeKioskBootstrap()` before React;
- arms `ChargeursNative.kioskUiReady()` handshake;
- mounts runtime guards;
- still initializes `initKioskHelpController()`.

Classification: **CANONICAL BOOT ENTRY + LEGACY HELP COLLISION**.

Accepted:
- neutral preboot before React;
- no old station/Home shell before React;
- native wrapper owns app lifecycle;
- native WebView does not keep a browser SW as an application-shell owner.

Not accepted as final:
- imperative legacy Help initialization competing with React Help ownership.

### `src/pwa/nativeKioskBootstrap.ts`
Current responsibilities:
- removes legacy kiosk service-worker/app-shell caches in native wrapper;
- performs at most one cache-busting navigation per bundle;
- does not mutate rental/payment/session business state.

Classification: **KEEP / CANONICAL BOOT-SHELL ADAPTER**.

Important boundary: this module may manage web-shell freshness only. It must not become the source of kiosk credential truth. Protected native credential persistence/reinjection belongs to the #102 native auth path.

---

## Outer kiosk composition

### `KioskPremiumGateV3`
Current responsibilities:
- production kiosk route composition;
- mounts atmosphere/director/product adapter/Home/journey chrome/pricing recovery/touch/Ads/auth guard;
- loads the full kiosk CSS stack including `kiosk-v4-canonical-1280x720.css` last;
- sets `data-kiosk-version` / scene-related document state.

Classification: **CANONICAL OUTER COMPOSER — MUST BE SIMPLIFIED**.

It remains the correct outer composition seam, but must progressively become a thin composition root rather than a host for many competing presentation owners.

### `KioskPremiumGateV2`
Current responsibilities include real journey orchestration/pairing/resume/timer logic and mounting `Kiosk.tsx` for the transactional path. It also still contains presentation markup and legacy V2 styling.

Classification: **ADAPTER / LEGACY VISUAL OWNER / TEMPORARILY REQUIRED**.

Decision:
- preserve the proven journey/state callbacks while extracting them behind an explicit presentation model;
- its visual hero/Home must remain invisible and non-interactive by construction;
- it must not remain a permanent second rendered kiosk shell.

### `Kiosk.tsx`
Current responsibilities:
- consumes canonical backend rental/quote/session state;
- renders selection, pricing/payment, hardware wait/release/active and return-related transactional surfaces;
- still mixes data/state consumption with presentation markup.

Classification: **CANONICAL BUSINESS-STATE CONSUMER / TRANSITIONAL PRESENTATION OWNER**.

Decision:
- do not rewrite Protected Core behavior into a new frontend state machine;
- progressively expose a stable `KioskPresentationModel` from the existing state consumer;
- move visual composition to the canonical V4 presentation layer without changing business transitions.

---

## Home / station / chrome

### `KioskV3OwnedHome`
Classification: **CANONICAL HOME OWNER**.

It is the only visible Home owner in the target architecture.

Product contract:
- Express = green;
- Client Chargeurs = blue;
- server-derived price/capability truth only;
- exactly one station visual slot;
- one Help entry;
- one language control;
- no legacy Home visible underneath.

### `KioskV3Atmosphere`
Classification: **KEEP AS OPTIONAL DECORATIVE BACKPLANE / MERGE OR RETIRE LATER**.

It may render passive atmosphere only. It must never own layout, CTA, state transitions or block touch/navigation. Agent 6 may eventually replace its visual function through the approved 3D/fallback contract.

### `KioskV3CinematicDirector`
Classification: **TRANSITIONAL / MERGE INTO PRESENTATION MODEL OR RETIRE**.

It may map already-canonical state to decorative scene classes/data attributes, but must never infer payment/ejection/return success from DOM or timers.

### `KioskV3JourneyChrome`
Classification: **CANONICAL PROGRESS/NAVIGATION OWNER, SUBJECT TO V4 CONSOLIDATION**.

Exactly one owner for:
- progress rail;
- safe Back/Cancel affordance;
- transactional navigation chrome.

It must consume presentation state, not inspect arbitrary child DOM to determine business truth.

### `KioskV3PricingRecovery`
Classification: **TRANSITIONAL ADAPTER / MERGE**.

Recovery presentation is valid, but pricing truth stays server-owned. Its visual/retry behavior should be absorbed into the canonical presentation model rather than remain an independent visual layer indefinitely.

### `KioskV3TouchFeedback`
Classification: **KEEP UTILITY** if it stays purely tactile/presentation-only and does not create duplicate action dispatch.

---

## Help / FAQ

Current evidence: `main.tsx` still calls `initKioskHelpController()` while React-side Help work also exists in the repository/PR lane.

Classification: **DUPLICATE OWNER / MUST CONVERGE**.

Target owner: **one React Help/FAQ surface owned by Agent 4**.

Rules:
- one `Aide` action -> one Help/FAQ surface;
- one close -> return to prior safe state;
- no imperative overlay plus React overlay;
- no second event listener reacting to the same user action;
- no Android Back dependency for normal close;
- Help never mutates rental/payment/hardware state.

The imperative `initKioskHelpController()` must be retired once the canonical React owner is integrated and physically verified.

---

## Advertising

### `KioskAdvertisingLayer`
Classification: **ADAPTER / KEEP WITH CONTRACT CHANGE**.

Agent 5 owns campaign/playlist/playback/cache/advertising analytics. Agent 4 owns whether the kiosk exposes an ad surface.

Target interface:

```ts
type AdvertisingContext = {
  stationId: string;
  surface: "home_split" | "idle_fullscreen";
  allowAdvertising: boolean;
  userActive: boolean;
};
```

Advertising must consume that stable contract. DOM sniffing, broad MutationObserver-driven inference and dependence on implementation-specific CSS selectors must be retired.

Invariant:

`ADS FAILURE == RENDER NOTHING`

Ads can never obscure or delay payment, ejection, return, auth failure, support or transactional recovery.

---

## Auth / offline / error

### `KioskV3AuthGuard`
Classification: **CANONICAL PRESENTATION GUARD / NOT AUTH SOURCE OF TRUTH**.

It owns explicit presentation for unauthenticated/activation-required state. It must not mint, recover or weaken credentials.

Native credential persistence/reinjection is a native owner responsibility under #102. Backend auth/RLS remains Protected Core.

### Runtime guards / blank-screen guards
Classification: **KEEP FAIL-SAFE UTILITY**.

They may prevent a blank customer screen and expose explicit support/error UI. They may not synthesize successful business state.

---

## Timeout ownership

### `KioskV3TimeoutOwnershipGuard` + V2 timer behavior
Classification: **DUPLICATE/TRANSITIONAL — CONVERGE TO ONE POLICY OWNER**.

Target policy:
- timeout allowed only on reversible, non-critical browsing/selection/pairing states;
- no timeout during active payment QR after financial intent is live, payment-confirmed, hardware release, ambiguous release reconciliation, active return/settlement, or any state where abandoning UI could hide a continuing mutation;
- user activity resets only the canonical safe-state timeout;
- timeout action returns to Home only after safe-state confirmation.

One policy function should decide `timeoutAllowed`, and one presentation component should display the countdown.

---

# TARGET_OWNER_MAP

| Surface / capability | Target owner | Notes |
|---|---|---|
| Native app/WebView lifecycle | Native kiosk owner via Agent 0 dispatch | No UI/business redesign |
| Native credential persistence/reinjection | #102 native owner | Protected auth boundary |
| Pre-React neutral boot | `main.tsx` + `nativeKioskBootstrap` | No station/Home before React readiness |
| Canonical kiosk composition root | `KioskPremiumGateV3` successor | Thin composer only |
| Canonical business state | existing backend + proven Kiosk state consumer | Protected Core truth |
| Presentation model | Agent 4-owned adapter contract, architecture governed by Agent 1 | Derived only from canonical state |
| Home | `KioskV3OwnedHome` successor | Single visible owner |
| Station visual slot | Agent 4 integration; Agent 6 renderer primitive | Renderer never owns state |
| Header/language/system controls | Agent 4 canonical V4 chrome | Single owner |
| Progress rail | Agent 4 canonical V4 chrome | Single owner |
| Help/FAQ | Agent 4 React Help owner | Imperative legacy controller retired |
| Timeout/cancel presentation | Agent 4 | One policy/one visible owner |
| Selection presentation | Agent 4 | Physical topology `1 | 3 / 2 | 4` |
| Pricing presentation | Agent 4 | Server quote only |
| Payment/QR presentation | Agent 4 | Payment truth from backend/Stripe state |
| Hardware wait/release/active presentation | Agent 4 | No animation-driven success |
| Return/settlement presentation | Agent 4 | Contractual physical return truth only |
| Auth/offline/error presentation | Agent 4 guard UI | Auth truth outside presentation |
| Advertising playback | Agent 5 | Only through Agent 4 surface contract |
| Physical QA/release proof | Agent 8 | Exact SHA/build/APK/deploy/station |

---

# COMPONENT_CLASSIFICATION

## CANONICAL / KEEP
- `KioskPremiumGateV3` — keep as composition seam, simplify.
- `KioskV3OwnedHome` — canonical Home owner.
- `KioskV3JourneyChrome` — canonical chrome/progress direction, simplify contract.
- `KioskV3AuthGuard` — canonical auth-failure presentation.
- `KioskV3TouchFeedback` — keep if action-neutral.
- `nativeKioskBootstrap` — canonical shell-freshness adapter.
- runtime error/blank guards — keep fail-safe.

## ADAPTER
- `KioskPremiumGateV2` — temporary journey/state callback adapter; visual ownership must disappear.
- `Kiosk.tsx` — current canonical state consumer; presentation gradually extracted.
- `KioskAdvertisingLayer` — keep only behind stable surface contract.

## MERGE / RETIRE AFTER ABSORPTION
- `KioskV3PricingRecovery` — absorb into presentation model/error state.
- `KioskV3CinematicDirector` — reduce to pure view mapping or replace with presentation model.
- duplicate timeout logic — converge to one policy.

## DUPLICATE / DELETE AFTER VERIFIED REPLACEMENT
- imperative `initKioskHelpController()` once React Help is canonical;
- any V2 hero/Home markup that remains interactive/reachable;
- any old HomeChrome owner still reachable;
- duplicate station representations;
- duplicate loading/boot surfaces beneath canonical boot.

## DECORATIVE / OPTIONAL
- `KioskV3Atmosphere` until Agent 6 handoff; never required for transactional correctness.

---

# STATE_TO_PRESENTATION_CONTRACT

The canonical UI must consume a bounded presentation model. Illustrative contract:

```ts
type KioskScene =
  | "BOOT"
  | "HOME"
  | "CLIENT_PAIRING"
  | "CLIENT_CONNECTED"
  | "SELECTION"
  | "PRICING"
  | "PAYMENT"
  | "PAYMENT_CONFIRMED"
  | "HARDWARE_WAIT"
  | "RELEASE_CONFIRMED"
  | "ACTIVE"
  | "RETURN_WAIT"
  | "RETURN_DETECTED"
  | "SETTLING"
  | "COMPLETED"
  | "SUPPORT"
  | "OFFLINE"
  | "AUTH_REQUIRED"
  | "ERROR";

type KioskPresentationModel = {
  scene: KioskScene;
  journey: "express" | "client" | null;
  stationId: string;
  canonicalState: string | null;
  stateVersion: number | null;
  quote: ServerQuote | null;
  selectedSlotNum: number | null;
  contractualBatteryId: string | null;
  physicalReleaseConfirmed: boolean;
  physicalReturnConfirmed: boolean;
  timeoutAllowed: boolean;
  backAllowed: boolean;
  cancelAllowed: boolean;
  allowAdvertising: boolean;
  errorCode: string | null;
};
```

Rules:
1. the model is derived from canonical backend/native state, never from CSS or animation completion;
2. `PAYMENT_CONFIRMED != RELEASE_CONFIRMED`;
3. provider HTTP acknowledgement alone is not physical release truth;
4. `RELEASE_CONFIRMED` requires the accepted physical-evidence contract from the Protected Core owner;
5. return completion/settlement presentation follows the canonical contractual `BATTERY_IN` rule;
6. UI may render optimistic tactile feedback for a tap, but never optimistic financial/hardware success;
7. station topology for the 4-slot cabinet is `1 | 3` over `2 | 4`.

---

# LEGACY_RETIREMENT_ORDER

## Phase 0 — already accepted on current main
- remove the old pre-React `#kiosk-premium-final` visual shell from `index.html`;
- neutral native preboot only;
- purge obsolete native WebView app-shell cache/SW before React.

## Phase 1 — Help and boot single ownership
- merge/port the single React FAQ owner;
- remove `initKioskHelpController()` after automated + physical validation;
- ensure no old boot/Home can become visible while auth/snapshot is pending.

## Phase 2 — Home single ownership
- keep `KioskV3OwnedHome` as sole visible Home;
- ensure V2 hero is non-visual/non-interactive by construction, not merely hidden after paint;
- remove any remaining duplicate station/Home owner.

## Phase 3 — explicit presentation model
- extract state-to-presentation mapping from V2/Kiosk without rewriting Protected Core;
- make JourneyChrome/Auth/Timeout/Ads consume explicit model/context rather than DOM observations.

## Phase 4 — transactional surfaces
In order:
`SELECTION -> PRICING -> PAYMENT -> HARDWARE WAIT/RELEASE -> ACTIVE -> RETURN -> COMPLETED/ERROR`.

For each state, retire old presentation only after the canonical V4 surface passes deterministic tests.

## Phase 5 — remove residual V2 presentation
Once every required scene is owned by V4:
- V2 becomes a headless/state adapter or is removed if no longer needed;
- obsolete V2/premium CSS imports are deleted;
- no hidden interactive subtree remains.

---

# CSS_RETIREMENT_PLAN

Current `KioskPremiumGateV3` imports many independent presentation layers. The new `kiosk-v4-canonical-1280x720.css` is accepted as a **current convergence surface**, not permission to retain permanent CSS archaeology.

Rules:
1. no new `*-hotfix-*`, `*-recovery-*`, `*-director-*` or “loaded last” stylesheet without an explicit retirement target;
2. every rule moved into canonical V4 must identify the older stylesheet/rule it supersedes;
3. after physical acceptance of each V4 scene, delete superseded selectors instead of keeping both;
4. common tokens/layout primitives should move to one canonical V4 stylesheet/module/token layer;
5. state visibility should come primarily from component ownership and presentation model, not escalating `!important` specificity;
6. reduced-motion, safe fallback and measured low-height rules remain first-class requirements;
7. physical viewport must be measured by #134/#130; `1280x720` is the current calibration target, not a substitute for recorded `innerWidth/innerHeight/DPR/insets` evidence.

Desired end state: a small canonical token/base layer plus scene/component-owned styles, not a chronological stack of rescue files.

---

# NATIVE_BOOT_BOUNDARY

Native wrapper owns:
- app/WebView lifecycle;
- protected kiosk credential storage/reinjection;
- connectivity/lifecycle signals;
- kiosk update/build lifecycle;
- WebView fullscreen/insets configuration;
- explicit bridge primitives such as `kioskUiReady()`.

Web kiosk owns:
- neutral preboot after JavaScript loads;
- canonical auth-required/offline presentation;
- app-shell cache cleanup in native WebView where appropriate;
- presentation of state supplied by native/backend.

Forbidden:
- web presentation storing the long-lived kiosk credential as its primary persistence mechanism;
- native wrapper inventing rental/payment/ejection success;
- two concurrent native writers (#102 and WisePad integration) modifying bootstrap/lifecycle without Agent 0 single-writer arbitration.

Recommended order remains: close #102 native credential lifecycle first; WisePad audit remains read-only until Agent 0 authorizes the post-#102 implementation baseline.

---

# AGENT4_BOUNDARY

Agent 4 owns:
- presentation components;
- layout/hierarchy;
- language/help/navigation surfaces;
- presentation model adapter code where it does not alter Protected Core semantics;
- physical slot visualization;
- error/offline/auth-required UX;
- 1280x720/actual-WebView responsive composition;
- integration seam for Agent 6 visual renderer and Agent 5 advertising surface.

Agent 4 does **not** own:
- price calculation/mapping;
- Stripe intent/capture/refund;
- rental state transitions;
- hardware command issuance;
- physical release confirmation rules;
- return correlation/settlement;
- kiosk credential security policy;
- Inventory truth.

Any required change across those boundaries is a handoff, not an opportunistic edit.

---

# AGENT6_3D_BOUNDARY

Agent 6 supplies reusable render primitives/assets and performance tiers:
- station renderer;
- powerbank renderer;
- selected-slot focus;
- state-driven visual cues;
- HIGH/MEDIUM/SAFE tiers;
- reduced-motion/non-WebGL fallback;
- license provenance.

Agent 6 receives presentation state only. It cannot infer state or dispatch business actions.

The station/powerbank visual mounts inside an Agent 4-owned visual slot. Agent 4 may disable or downgrade it without changing business functionality.

`3D FAILURE == FALLBACK VISUAL`, never transaction failure.

---

# AGENT8_QA_HOOKS

Every physically validated candidate must identify:
- Git SHA;
- Vercel deployment ID/URL used;
- APK version/build/hash;
- Supabase migration ledger relevant to the flow;
- Edge Function versions;
- station/device ID;
- actual `innerWidth/innerHeight`, visualViewport, DPR and Android inset/fullscreen observations.

Required visual ownership checkpoints:
1. BOOT — neutral canonical boot only;
2. HOME — exactly one Home/station/header;
3. HELP — exactly one FAQ surface;
4. SELECTION — topology `1 | 3 / 2 | 4`, no contradictory availability;
5. PRICING — server quote only;
6. PAYMENT — QR/confirmed state distinct from physical release;
7. HARDWARE — no synthetic success;
8. RETURN — contractual physical evidence before completion;
9. OFFLINE/AUTH — explicit recoverable state, never infinite spinner;
10. RESTART — no legacy shell, no duplicate mutation, auth restored according to #102.

`CI GREEN != PREVIEW READY != DEPLOYED != APK INSTALLED != PHYSICALLY VALIDATED`.

---

# COLLISIONS

## C1 — Native Android writer collision
#102 auth persistence/reinjection and #144/#95 WisePad Android work share the native wrapper lifecycle surface.

Architecture recommendation to Agent 0:
- #102 native write first;
- WisePad audit read-only meanwhile;
- WisePad implementation from post-#102 baseline only.

## C2 — PR #133 versus canonical V4
PR #133 is useful physical layout evidence but its last-loaded field CSS is not a permanent architecture layer.

Disposition: **ABSORB_NOT_STACK** into canonical V4 after measured viewport evidence.

## C3 — PR #136 frontend versus Protected Core
PR #136 mixes ejection/return safety with Kiosk presentation.

Disposition: split by owner. Agent 4 receives only presentation-safe changes such as physical topology/state distinction after Agent 1/3 define the business contract.

## C4 — Help owner
`initKioskHelpController()` on current main conflicts with single React Help ownership.

Disposition: retire imperative controller after canonical React FAQ is integrated/tested.

## C5 — CSS owner stack
Multiple director/hotfix/recovery styles plus canonical V4 create competing specificity.

Disposition: scene-by-scene deletion ledger required as V4 absorbs behavior.

---

# RISKS

1. **Hidden duplicate owner risk:** a visually hidden legacy component can still receive events or mutate state.
2. **CSS timing/flash risk:** hiding an old shell after React mount is insufficient for cold boot; component ownership must make it non-visual by construction.
3. **State inference risk:** cinematic/director/Ads code can accidentally infer business state from DOM rather than explicit model.
4. **Native collision risk:** auth and WisePad work can both modify WebView lifecycle/bootstrap.
5. **Physical viewport assumption risk:** CSS target dimensions may differ from actual WebView CSS viewport/DPR/insets.
6. **Regression-by-cleanup risk:** V2 contains real pairing/resume/timer orchestration; visual retirement must not delete proven state behavior accidentally.
7. **Release identity risk:** a READY preview is not proof the APK is displaying that build.

---

# NEXT_HANDOFFS

## To Agent 0
- enforce native single-writer decision (#102 before WisePad native implementation unless Agent 0 explicitly replaces this order);
- keep #128 as the sole Agent 4 canonical presentation writer;
- prevent #133/#101/older branches from becoming parallel implementation owners;
- enforce scene-by-scene owner handoffs and WIP limit.

## To Agent 4
Implement #128 against this architecture:
1. preserve current pre-React shell removal;
2. make V2 visual subtree non-interactive/invisible by construction;
3. converge Help to one React owner and prepare removal of imperative controller;
4. expose/consume explicit presentation model/context;
5. absorb useful #133 decisions without adding another permanent last-loaded layer;
6. progressively delete superseded CSS as scenes are accepted.

## To Agent 3/native owner
- close #102 without altering kiosk presentation architecture;
- provide measured #134 viewport/inset evidence to Agent 4/8;
- no UI redesign.

## To Agent 6
- supply renderer contract only after #82 concrete prototype/license/performance evidence;
- do not write production navigation/business-state files.

## To Agent 5
- wait for stable `AdvertisingContext`/surface contract;
- do not deepen DOM sniffing.

## To Agent 8
- verify the exact candidate physically across boot/restart/Home/transaction/help/error states;
- reject any candidate showing more than one visible owner or any stale/legacy shell.

---

# Architecture acceptance

This document authorizes **incremental convergence**, not immediate merge/release of any particular implementation PR.

Target Definition of Done:

- one neutral native/pre-React boot;
- one visible Home;
- one station visual owner;
- one header/language owner;
- one progress owner;
- one Help/FAQ owner;
- one timeout policy/owner;
- one presentation owner per transactional state;
- no visual/animation-derived business success;
- no hidden interactive legacy shell;
- measured real WebView viewport support;
- exact-SHA physical validation by Agent 8.

Final architecture status: **ACCEPTED TARGET / CURRENT RUNTIME PARTIALLY CONVERGED / IMPLEMENTATION + PHYSICAL QA REQUIRED**.
