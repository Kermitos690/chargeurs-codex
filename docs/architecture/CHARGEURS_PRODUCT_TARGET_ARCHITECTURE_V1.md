# CHARGEURS PRODUCT TARGET ARCHITECTURE V1

Owner: **AGENT 1 — Chargeurs Control Center**  
Parent: **#119 / #114**  
Baseline: current repository and active control boards as reviewed on 2026-08-12.  
Status: **TARGET ARCHITECTURE DECIDED / EXECUTION REMAINS DOMAIN-OWNED**

## 0. Purpose

Chargeurs.ch has enough implemented surface area that the main risk is no longer “nothing exists”. The dominant risk is **divergence**: multiple UI owners, overlapping Protected Core PRs, stale deployments, provider truth versus physical truth, admin/runtime Inventory mismatch, and parallel agents modifying adjacent layers without a stable contract.

The target product architecture is therefore based on four rules:

1. **one source of truth per domain**;
2. **one writer per implementation surface at a time**;
3. **business state and physical evidence before presentation**;
4. **MERGED != DEPLOYED != PHYSICALLY VALIDATED**.

The product must converge to:

`USER SURFACE -> AUTHORIZED SERVER CONTRACT -> CANONICAL BUSINESS STATE -> EXTERNAL/PHYSICAL SIDE EFFECT -> VERIFIED EVIDENCE -> PRESENTATION / OPERATIONS`

No frontend, animation, advertising layer, supplier callback or deployment label may bypass this chain.

---

# CURRENT_MAP

| Area | Current classification | Current truth / debt |
|---|---|---|
| Public website | EXISTS / PARTIAL | Customer-facing web exists; not current P0. Premium redesign must not destabilize core rental recovery. |
| Kiosk / Android WebView | PARTIAL / LEGACY / DUPLICATE | V4 progress exists, old pre-React shell removed, but V2 remains mounted as adapter, CSS/presentation owners remain layered, native auth restart unresolved. |
| Client/account | PARTIAL | Account/member flows exist; user reports loading loops; member physical quote path has divergence #85. |
| Pricing | EXISTS / PARTIAL | Canonical server mappings exist for guest/member; physical/deployed Member path not yet proven. |
| Stripe Checkout QR | EXISTS / WORKING_PARTIAL | Real test Checkout has worked. Remains canonical MVP payment path. |
| Stripe Terminal / WisePad USB | NOT_IMPLEMENTED_AS_PRODUCTION_CHANNEL / AUDIT_IN_PROGRESS | Hardware diagnostic and integration planning exist; no production Terminal SDK channel should be inferred. |
| Rental state machine | EXISTS / UNSAFE_AT_EDGE | Core exists, but #55 stuck ejection, #92 multi-release and release-evidence issues block customer-ready declaration. |
| Kiosk authentication | PARTIAL / UNSAFE_ON_RESTART | Server device valid; native protected persistence/reinjection #102 not physically closed. |
| Station/provider integration | EXISTS / PARTIAL / UNSAFE | ChargeNow/provider path is operational but physical multi-release proves provider/cabinet behavior can diverge from intended command. |
| Return / settlement | EXISTS / UNSAFE_CANDIDATES | #81 is preferred canonical direction: contractual BATTERY_IN before settlement. Overlapping older candidates must not stack. |
| Inventory / suppliers | EXISTS / PARTIAL | Bajie supplier catalog and serialized Inventory foundation exist; physical/runtime reconciliation and deployability qualification remain incomplete. |
| Advertising | PARTIAL / COUPLED | Ads runtime exists but must migrate from DOM sniffing to explicit Kiosk surface contract. |
| Admin / back office | EXISTS / PARTIAL | Admin surfaces including Inventory exist; auth/platform degradation and deployment identity impair reliable access. |
| Monitoring / observability | PARTIAL | Logs/incidents exist, but correlation across user/payment/rental/provider/physical/release needs one minimum contract. |
| Support / recovery | PARTIAL | Support states/incidents exist but some failure paths still manifest as endless spinner or ambiguous state. |
| Analytics | PARTIAL / NON-CANONICAL | Product/ads/ops analytics exist in pieces; not a source of transaction truth. |
| Deployment / release | UNSAFE / DUPLICATE REALITY | GitHub main, Vercel preview/canonical staging, Edge versions and APK installed build can diverge. Agent 8 gate mandatory. |

---

# TARGET_MAP

## 1. Public web

Target:
- public acquisition/education surface;
- station discovery/location search;
- pricing/terms sourced from canonical configuration;
- no direct ownership of rental/hardware state;
- authenticated account entry routes through shared auth contract.

Owner decision: no verified dedicated public-web implementation owner is introduced by Agent 1. Agent 0 must assign from the actual available roster when this lane is activated. Until then, broad website redesign remains behind transaction/auth stabilization.

## 2. Kiosk

Target architecture defined in `docs/kiosk/KIOSK_TARGET_ARCHITECTURE_V4.md`:

`NATIVE BOOT + AUTH -> CANONICAL KIOSK STATE -> PRESENTATION MODEL -> ONE VISIBLE KIOSK UI`

Kiosk owns interaction/presentation only. It consumes pricing, payment, rental, hardware and return truth.

## 3. Client/account

Target:
- one authenticated customer identity;
- member entitlements/segment resolved server-side;
- account balance/credits/history read from canonical backend;
- explicit loading/empty/error states;
- no infinite spinner;
- Wallet is projection only, never account truth.

Member pricing must never silently fall back to guest pricing.

## 4. Pricing

Target owner: **Agent 2 / backend-pricing domain**.

Canonical contract:

`station + customer segment + time/context -> immutable pricing snapshot for a rental/session`

Current approved baseline remains:
- Express guest: CHF 0.75 / 30 min, cap CHF 18/day;
- Client/member: CHF 0.75 / 60 min, cap CHF 9/day;
- deposit CHF 30;
- non-return/max CHF 99.

Frontend never recomputes or hardcodes customer charge truth.

## 5. Payment

### MVP channel
Stripe Checkout QR remains canonical until replaced by an explicitly approved migration.

### WisePad / Stripe Terminal
Target is a second controlled channel:

`WisePad 3 USB -> Android Chargeurs APK -> Stripe Terminal SDK -> Chargeurs backend -> Stripe`

It must coexist with Checkout during integration. ConnectionToken lifecycle, PaymentIntent ownership, idempotency, capture/cancel/recovery and reader association are backend contracts, not UI rules.

## 6. Rental / hardware command

Target invariant:

`ONE AUTHORIZED RENTAL RELEASE INTENT -> AT MOST ONE AUTOMATIC SUPPLIER EJECT MUTATION`

Architecture:
- persist hardware intent before supplier mutation;
- ambiguous provider result is reconciled, never automatically re-ejected;
- provider HTTP acknowledgement is not physical success;
- physical/provider events are recorded independently from contractual rental identity;
- extra physical release is anomaly/support evidence, not a second billable rental.

Protected Core owner must produce the final canonical implementation; PR #136 concepts may be absorbed but not merged wholesale across ownership boundaries.

## 7. Physical evidence

For a 4-slot station, physical topology is:

`1 | 3`
`2 | 4`

Canonical physical facts include:
- station ID;
- slot number;
- battery ID;
- event type;
- observed timestamp;
- provider trade/order identifiers where applicable;
- source/confidence.

Presentation may not reinterpret slot geometry.

## 8. Return / settlement

Canonical product rule:

`CONTRACTUAL BATTERY_IN -> RETURN ACCEPTED -> SETTLEMENT`

Preferred implementation direction: **#81**.

Requirements:
- exact contractual battery identity;
- return slot may differ from departure slot;
- physical BATTERY_IN required;
- provider-only callback cannot synthesize `returned_at`;
- ambiguous battery/rental match fails closed;
- duplicate callbacks are idempotent;
- settlement retries are controlled and observable.

Do not merge overlapping return candidates as additive fixes.

## 9. Inventory

Target owner: **Agent 7**.

Inventory owns:
- supplier master/evidence;
- product/SKU/catalog provenance;
- serialized physical assets;
- locations/movement ledger;
- quarantine/defect lifecycle;
- procurement/receiving/RMA;
- stock/deployment readiness evidence.

Inventory does not own:
- runtime rental transitions;
- ChargeNow eject commands;
- pricing/payment;
- kiosk UI.

Runtime hardware truth may feed Inventory observations, but runtime tables are not silently rewritten by Inventory.

Core invariant:

`QUARANTINED != DEFECTIVE`

and

`PHYSICALLY POSSESSED != EVENT DEPLOYABLE`.

## 10. Advertising

Target owner: **Agent 5**, behind Kiosk-owned surface contract.

Kiosk decides:
- whether a surface exists;
- whether advertising is allowed now;
- immediate interruption on user activity/transaction.

Advertising decides:
- campaign selection;
- playlist/media;
- playback/cache/fallback;
- ad analytics.

Invariant:

`ADVERTISING FAILURE == NO AD RENDERED`

Never transaction degradation.

## 11. Admin Control Center

Admin is a product surface, not an Agent 7-owned monolith.

Target modules:
- operations/stations;
- rentals/payment/support lookup;
- incidents/health;
- Inventory (Agent 7 data domain);
- supplier/procurement;
- advertising administration where appropriate;
- release/build visibility;
- customer/support tools with least privilege.

Ownership decision:
- each data module remains domain-owned;
- UI shell/admin product owner must be explicitly assigned by Agent 0 when broad admin work is activated;
- Agent 7 owns only Inventory/admin Inventory surfaces and contracts.

## 12. Observability

Minimum correlation contract across critical systems:

```text
correlationId
rentalSessionId
publicRentalCode (when safe)
stationId
deviceId
slotNum
contractualBatteryId
providerTradeNo / providerOrderId
paymentIntentId or Checkout session reference (server-side only where appropriate)
canonicalState
stateVersion
eventType
source
timestamp
release/build identity
```

No secrets/tokens in frontend or public logs.

Every P0 must be reconstructable from this chain without relying on screenshots alone.

## 13. Release / deployment

Target owner: **Agent 8**.

Every candidate must bind:

`GIT SHA / PR SET / MIGRATION LEDGER / EDGE FUNCTION VERSIONS / VERCEL DEPLOYMENT / APK VERSION+HASH / STATION+DEVICE / TEST WINDOW`

Definitions:
- MERGED = source accepted only;
- DEPLOYED = exact service/build promoted;
- APK INSTALLED = exact native artifact on hardware;
- PHYSICALLY VALIDATED = real station evidence on exact candidate;
- RELEASE READY = all required gates passed.

No other agent may collapse these states into “done”.

---

# OWNER_MAP

| Domain | Primary owner | Agent 1 role | Agent 0 role |
|---|---|---|---|
| Product architecture / cross-domain contracts | Agent 1 | Own | Dispatch consequences |
| Multi-agent WIP / dependencies / handoffs | Agent 0 | Advise/escalation | Own |
| Pricing/backend payment contracts | Agent 2 | Protected Core gate | Dispatch |
| RCA / minimal safety corrections | Agent 3 | Accept/reject cross-domain impact | Dispatch/WIP |
| Kiosk presentation/navigation | Agent 4 | Architecture/acceptance | Single-writer control |
| Advertising runtime | Agent 5 | Contract boundary | Dispatch |
| 3D/motion primitives | Agent 6 | Contract boundary | Dispatch |
| Inventory/supply chain/hardware asset truth | Agent 7 | Cross-domain gate via 1↔7 Bridge | Dispatch |
| Integration/release/physical QA | Agent 8 | Release architecture acceptance | Dependency control |
| Growth/partnerships | Agent 9 | Product/capacity truth gate | Dispatch |

No agent gains ownership of an adjacent domain merely because its PR touches that file.

---

# PROTECTED_CORE

Protected Core includes:
- server pricing resolution/snapshot;
- Stripe PaymentIntent/Checkout/capture/refund/settlement;
- rental lifecycle transitions;
- hardware command intent and supplier mutation;
- kiosk device authentication/credential security;
- physical release confirmation rules;
- physical return correlation;
- non-return handling;
- security/RLS/privileged functions affecting these paths.

Rules:
1. no frontend fallback that weakens a fail-closed server rule;
2. no timer-driven business success;
3. no automatic second ejection after ambiguous supplier result;
4. no settlement without accepted physical return evidence;
5. no broad security/RLS bypass for debugging;
6. Protected Core changes require owner tests + Agent 1/0 governance + Agent 8 integration evidence.

---

# LEGACY_DEBT

## Kiosk layers
- V2 remains mounted under V3/V4 as adapter;
- multiple presentation/CSS director/hotfix/recovery layers remain;
- legacy imperative Help controller still initialized on current main;
- old pre-React premium shell has now been removed — accepted completed retirement step.

## Protected Core overlap
- #72 versus #81 return paths;
- #136 overlaps release intent, return, settlement and presentation;
- overlapping work must be **absorbed into one canonical owner path**, not stacked.

## Release reality
- previews, canonical staging and installed APK have historically diverged;
- Vercel quota/block status has created merged-but-not-visible behavior.

## Inventory/runtime
- supplier catalog may be correct while admin deployment/auth prevents visibility;
- runtime station/slot/battery truth can diverge from serialized Inventory observation.

---

# RETIREMENT_ORDER

1. Stabilize platform/auth and P0 transaction integrity.
2. Close native kiosk credential lifecycle #102.
3. Close one-command/physical-release path (#55/#92 canonical safety implementation).
4. Integrate canonical return path #81 semantics.
5. Converge Kiosk presentation according to KIOSK TARGET ARCHITECTURE V4; remove duplicate Help/Home/timeout/CSS owners incrementally.
6. Reconcile runtime hardware and Inventory truth.
7. Freeze one exact release candidate and execute Agent 8 physical matrix/20-run gate where required.
8. Only then expand non-critical public site/Ads/3D/Wallet/Terminal features into launch paths.

This order may be parallelized by Agent 0 only when ownership and runtime dependencies are independent.

---

# DESIGN_SYSTEM_BOUNDARY

Shared design system may own:
- brand tokens;
- typography;
- color roles (Express green / Client blue);
- spacing/radius/elevation primitives;
- iconography rules;
- accessibility/touch-target standards;
- motion/reduced-motion conventions.

It must **not** centralize business logic or force public web/mobile/kiosk into the same component implementation when physical contexts differ.

Kiosk remains 16:9/WebView-first and may require dedicated composition primitives while sharing brand tokens.

---

# WEB_OWNER_DECISION

No new agent is invented by this document.

Public-web implementation ownership remains **UNASSIGNED FOR NEXT BROAD REBUILD** until Agent 0 selects an actual existing agent/capability. Current functional public work may continue only within already-owned scopes.

Do not divert Agent 4 from kiosk P0/P1 convergence to a broad public-site redesign during the active release freeze.

---

# ADMIN_OWNER_DECISION

Admin Control Center requires a future explicit UI/product owner chosen by Agent 0.

Until then:
- Agent 7 owns Inventory module data/admin Inventory contract;
- Agent 5 owns advertising-domain data/tools;
- Agent 2/3/8 own only their operational evidence/contracts, not the entire admin UI;
- no agent may declare itself owner of all back-office surfaces by adjacency.

---

# DEPENDENCIES

## Critical release path

`PLATFORM/AUTH STABLE`
-> `NATIVE KIOSK AUTH RESTART SAFE`
-> `ONE RENTAL = ONE AUTOMATIC EJECT INTENT`
-> `PHYSICAL RELEASE CORRECTLY CONFIRMED`
-> `CONTRACTUAL RETURN PHYSICALLY CORRELATED`
-> `SETTLEMENT IDEMPOTENT`
-> `KIOSK PRESENTATION SINGLE-OWNER`
-> `EXACT RELEASE CANDIDATE`
-> `PHYSICAL QA`
-> `CUSTOMER/EVENT READINESS`.

## Member path

Canonical guest/Express path must be stable first. Member path then requires:
- pairing claimed/consumed correctly;
- server member profile resolved;
- correct quote physically visible;
- same release/return safety invariants as Express.

If Member cannot be safely offered at launch, Product must explicitly hide/feature-flag it rather than expose a broken path or silently downgrade pricing.

---

# RISKS

1. **Parallel-owner risk** — two agents change native/kiosk/Protected Core files concurrently.
2. **False-completion risk** — PR/preview reported as done before deployment/physical proof.
3. **Provider-trust risk** — HTTP/provider callback mistaken for physical truth.
4. **Presentation-truth risk** — animation/DOM state mistaken for canonical business state.
5. **Migration-ledger risk** — stacked SQL branches collide or replay incorrectly.
6. **Auth/platform risk** — retries and degraded DB/auth can create global spinner storms and amplify load.
7. **Inventory inference risk** — observed runtime identifiers promoted to ownership/model/fitness without evidence.
8. **Commercial-capacity risk** — Growth promises capacity before Inventory + Release verifies it.

---

# NEXT_HANDOFFS

## Agent 0
- enforce active WIP and single-writer decisions;
- resolve native #102 versus WisePad implementation ordering;
- keep Agent 3 WIP bounded;
- assign future web/admin broad UI owners only from verified roster;
- treat #137/#135 as launch/event readiness boards, not feature wishlists.

## Agent 2
- close current pricing/member deployment divergence before expanding payment channels;
- produce WisePad backend audit/contract before implementation;
- preserve Checkout and validated pricing rules.

## Agent 3
- prioritize bounded P0 causal lanes;
- supply minimal owner-safe patches and handoffs;
- no redesign.

## Agent 4
- implement the Kiosk V4 target architecture;
- single presentation owner per scene;
- no Protected Core semantics.

## Agent 5
- migrate advertising to explicit surface contract after Agent 4 handoff.

## Agent 6
- deliver isolated real-3D assets/prototype/licence/performance proof; production integration only through Agent 4 + Agent 8.

## Agent 7
- reconcile physical holdings/runtime/Inventory and event deployability;
- preserve provenance; no rental/runtime command ownership.

## Agent 8
- build only owner-approved integrated candidates;
- maintain exact release manifest and physical evidence;
- reject merged/preview-only completion claims.

## Agent 9
- continue research/preparation;
- consume verified capacity only from Agent 0/Event Readiness handoff;
- `PREPARE != SEND` remains absolute.

---

# Final architecture decision

Chargeurs.ch is **FOUNDATION SUBSTANTIAL / CURRENTLY NOT RELEASE-SAFE / TARGET ARCHITECTURE DEFINED**.

The project should not be restarted from zero. The correct strategy is controlled convergence:

`PRESERVE PROVEN DOMAIN TRUTH -> REMOVE DUPLICATE OWNERS -> FAIL CLOSED ON PHYSICAL/FINANCIAL AMBIGUITY -> INTEGRATE ONE EXACT CANDIDATE -> PHYSICALLY VALIDATE`.

This document governs architecture and ownership. It does not itself authorize production deployment, external supplier/partner contact, payment changes, hardware action or release.
