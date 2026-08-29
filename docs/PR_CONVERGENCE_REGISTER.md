# Chargeurs.ch — PR Convergence Register

Status date: **2026-08-29**
Observed open PR count: **47** (34 Draft, 13 non-Draft)

This register recommends preservation, extraction or later evidence-based
closure. It does not close, merge, rebase or modify any PR.

Mergeability is the GitHub value observed during the audit and can change when
base/head branches move.

## Disposition vocabulary

- KEEP: retain the PR as evidence or an active review unit.
- EXTRACT: recover selected unique commits/files into a smaller PR.
- PORT: recreate the relevant change on current main with current contracts.
- REWORK: useful intent exists, but the branch/architecture is not directly usable.
- SUPERSEDED: a later implementation/runtime decision appears to replace it.
- CLOSE_AFTER_PROOF: likely closable only after unique-change and runtime checks.
- UNKNOWN: evidence is insufficient.

## Open PR register

| PR | Base | Head | Draft | Mergeable | Area | Unique evidence/code | Overlap / dependency | Runtime relevance | Recommended disposition |
|---:|---|---|:---:|:---:|---|---|---|---|---|
| #341 | feat/cloudflare-staging-20260827 | fix/dta21269-cloudflare-runtime-origin-20260827 | YES | NO | Android / Cloudflare origin | Split enrollment and WebView-origin tests | Depends on #338; metadata/artifact mismatch | No station authorized on Cloudflare | REWORK; do not merge |
| #338 | main | feat/cloudflare-staging-20260827 | YES | YES | Cloudflare hosting, proxy, AI, auth, Android, DB, Stripe | Pages proxy, hosting diagnostics, selected hardening | 106 commits; crosses eight functional domains | Parallel site live, not fleet runtime | EXTRACT into domain PRs; never merge monolith |
| #335 | main | hardening/pre-production-zero-cost | YES | YES | Hardening, pricing V3, prepaid | Pricing/prepaid tests, migration and runtime evidence | 84 commits; staging ledger already differs | Pricing/prepaid objects are present in staging | EXTRACT after migration mapping |
| #307 | fix/staging-kiosk-ui-convergence-20260825 | main | NO | NO | Reverse convergence PR | PR topology evidence | Head is main, base is a field branch | Not a release source | CLOSE_AFTER_PROOF |
| #306 | fix/staging-mobile-rental-progress | fix/staging-mobile-rental-progress-returns-sync | NO | YES | Return projection | Two-commit physical-return projection | Depends on non-main mobile-progress branch | Return behavior may be unique | EXTRACT |
| #301 | main | fix/dta21269-terminal-sdk-5-7 | YES | NO | Android / Stripe Terminal 5.8 | Source configuration textually matching DTA21277 1.0.58 | 71 branch commits; 101 main commits missing | Highest Android runtime relevance, provenance still missing | EXTRACT and REWORK |
| #300 | main | a2/wallet-pass-studio-convergence | YES | NO | Wallet | Pass Studio convergence commits | Overlaps runtime-only Apple Wallet functions | Wallet functions active in runtime | EXTRACT |
| #294 | main | a5/p0-home-landscape-smart-crop | NO | YES | Advertising / kiosk UI | Landscape smart-crop fix | Overlaps later kiosk/ads branches | Possible field UI relevance | PORT after visual evidence |
| #279 | main | hotfix/p0-terminal-cancel-lock-20260822 | YES | NO | Terminal cancellation | ENGAGED cancellation guards | Overlaps #301 and later cancellation work | Potential field safety relevance | EXTRACT |
| #278 | main | codex/trigger-1-0-32-rebuild | YES | YES | CI / APK trigger | YAML label correction | Obsolete APK-generation lineage | No current installed 1.0.32 | CLOSE_AFTER_PROOF |
| #271 | main | agent/p0/trigger-restore-apk-131 | NO | YES | CI / APK 1.0.31 | Historical build trigger | Superseded by later installed versions | Rollback evidence only | SUPERSEDED; CLOSE_AFTER_PROOF |
| #254 | main | a2/pilot-battery-quarantine-convergence | YES | YES | Hardware quarantine | Reservation-boundary quarantine guard | Overlaps #136, #202, #213 | Potential release-safety relevance | PORT selected guard |
| #239 | main | a0/rc119-apk-build-proof | NO | NO | Android RC119 | Historical artifact proof attempt | Superseded Android lineage | Not current field runtime | SUPERSEDED; preserve artifact evidence |
| #217 | main | agent/inventory/catalog-product-cards-v2 | YES | NO | Inventory catalog | Mobile catalog/photos/pre-order | Overlaps inventory chain #63–#73 | Runtime inventory-catalog is Git-missing | EXTRACT after schema/source comparison |
| #213 | main | codex/converge-core-ejection-return | YES | NO | Ejection / return | Physical-proof guards for release and return | Strong overlap with #202/#181/#136 | Critical hardware-state relevance | EXTRACT canonical invariants |
| #212 | main | agent/fix-guest-deposit-contract | YES | NO | Pricing / deposit | Guest deposit contract correction | Overlaps #335 pricing V3 | Active pricing is DB-owned | PORT only after pricing snapshot comparison |
| #202 | main | agent/roadmap/p0-release-return-mainline | YES | NO | Ejection / return | Earlier physical-proof implementation | Overlaps #213 | Potentially superseded by #213/runtime | CLOSE_AFTER_PROOF |
| #190 | main | agent/creative-3d/canonical-webgl-v3 | NO | YES | Kiosk visual / WebGL | 3D renderer | Non-release priority; overlaps UI generations | Runtime relevance UNKNOWN | KEEP / defer |
| #189 | agent/kiosk-ux/public-beta-premium-v6 | agent/kiosk-ux/dta21269-pricing-first-progress-v1 | YES | YES | Kiosk pricing UI | Pricing-first progress rail | Nested on non-main premium V6 | May describe field presentation | REWORK on main after pricing truth |
| #186 | main | agent/product-command-center-foundation | YES | YES | Admin | Product Command Center foundation | Overlaps current admin surfaces | Runtime relevance UNKNOWN | KEEP / later product review |
| #184 | agent/kiosk-wisepad3-stripe-terminal-usb | agent/kiosk-security/operator-recovery-gate-v1 | YES | NO | Operator recovery / Android | Offline recovery gate | Depends on old Terminal foundation | Security relevance possible | EXTRACT |
| #181 | main | agent/hardware/safe-maintenance-ejection | YES | NO | Hardware | Double-ejection prevention | Overlaps #202/#213 and maintenance functions | Critical if unique | EXTRACT after invariant diff |
| #176 | main | agent/inventory/physical-label-enrollment | YES | YES | Inventory | Physical labels/battery enrollment | Depends on inventory model | Field inventory relevance UNKNOWN | KEEP / map dependencies |
| #175 | main | agent/governance/agent-operating-system-v2 | YES | YES | Governance docs | Agent governance material | Not runtime behavior | None | KEEP or archive as historical docs |
| #174 | agent/kiosk-wisepad3-stripe-terminal-usb | agent/kiosk-ux/public-beta-premium-v6 | YES | NO | Kiosk UX | Premium V6 physical overhaul | Depends on old Terminal base; many later UI fixes | Some field presentation may derive from it | REWORK |
| #169 | main | agent/architecture/terminal-presentation-contract-v1 | NO | YES | Architecture docs | Terminal/presentation contract | Referenced by #168/#167 | Useful decision evidence | PORT into canonical docs if still valid |
| #168 | main | agent/backend/wisepad3-stripe-terminal-audit | YES | YES | Terminal backend | Stripe Terminal TEST backend | Overlaps runtime-only stripe-terminal-backend and #301 | High backend relevance | EXTRACT after runtime source recovery |
| #167 | main | agent/kiosk-wisepad3-stripe-terminal-usb | NO | YES | Android / Terminal foundation | Original WisePad 3 USB staging foundation | Base for #174/#184; superseded SDK generations | Historical source lineage | EXTRACT required invariants; do not merge wholesale |
| #151 | main | agent/architecture/product-target-v1 | NO | YES | Architecture docs | Product target v1 | Stale assumptions possible | Documentation evidence only | KEEP as HISTORICAL / selected PORT |
| #150 | main | agent/architecture/kiosk-target-v4 | NO | YES | Architecture docs | Kiosk target V4 | Multiple later field generations | Documentation evidence only | KEEP as HISTORICAL / selected PORT |
| #136 | main | codex/chargeurs-p0-safety-ui | YES | NO | Hardware safety UI | Ambiguous-release quarantine UX | Overlaps #181/#202/#213/#254 | Safety relevance possible | EXTRACT |
| #133 | main | agent/kiosk-ux/field-selection-composition | NO | NO | Kiosk UI | Physical selection composition | Superseded by many later UI branches | Field lineage possible | PORT only with visual proof |
| #90 | main | agent/inventory/wisepad3-usb-integration | YES | YES | Terminal/inventory docs | WisePad USB integration plan | Precedes implemented SDK work | Historical only | KEEP as HISTORICAL |
| #83 | main | agent/apple-wallet-sandbox-v2 | YES | NO | Apple Wallet | Real-data Wallet sandbox | Runtime has three Git-missing Wallet functions | High source-recovery relevance | EXTRACT after runtime bundle recovery |
| #81 | main | agent/qa/protected-return-correlation | YES | YES | Return | Return correlation independent of departure slot | Overlaps #202/#213/#306 | Critical return invariant possible | PORT selected invariant |
| #77 | main | agent/qa/issue-75-member-pricing | YES | YES | Member pricing | Older approved member-profile support | Superseded/overlapped by pricing V3 #335 | Runtime pricing has newer versions | CLOSE_AFTER_PROOF |
| #73 | agent/inventory/defect-lifecycle | agent/inventory/procurement-rma | YES | YES | Inventory / RMA | Procurement and guarded RMA | Final link in nested inventory chain | Runtime relevance UNKNOWN | REWORK chain as one reviewed model |
| #70 | agent/inventory/supplier-catalog | agent/inventory/supplier-contacts | YES | YES | Supplier contacts | Supplier capability evidence | Nested inventory base | Runtime relevance LOW/UNKNOWN | EXTRACT non-secret evidence |
| #68 | agent/inventory/asset-ledger | agent/inventory/defect-lifecycle | YES | YES | Inventory defects | Quarantine vs defect separation | Nested inventory chain | Schema relevance possible | REWORK with canonical schema |
| #65 | agent/inventory/supplier-catalog | agent/inventory/asset-ledger | YES | YES | Inventory assets | Serialized asset/location ledger | Nested inventory chain | Schema relevance possible | REWORK with canonical schema |
| #63 | main | agent/inventory/supplier-catalog | YES | YES | Supplier catalog | Supplier master/catalog foundation | Base for #65/#70/#68/#73 | Runtime inventory source divergence | EXTRACT after DB comparison |
| #51 | main | agent/frontend-quality-v1 | NO | YES | Frontend QA | Quality-agent/test infrastructure | May overlap current CI policy | No direct runtime relevance | UNKNOWN / review separately |
| #41 | agent/dta21269-freetest-local | agent/dta21269-dex-callgraph | NO | YES | Android diagnostics | Passive DEX call-graph analyzer | Depends on historical FreeTest branch | Diagnostic evidence only | KEEP as ARCHIVE_REFERENCE |
| #40 | agent/finalize-chargeurs-platform | agent/chargenow-transition-readonly | YES | NO | ChargeNow read-only audit | Transition snapshot | Overlaps runtime chargenow-readonly-audit | Source-recovery relevance | EXTRACT |
| #39 | agent/chargenow-local-diagnostics | agent/dta21269-freetest-local | YES | YES | Local diagnostics | Standalone local FreeTest gateway | Historical nested diagnostic line | Hardware diagnostic evidence | KEEP as ARCHIVE_REFERENCE |
| #38 | agent/chargenow-local-diagnostics | ops/deploy-staging-kiosk-20260724 | YES | YES | Historical staging deploy | Early DTA21269 backend deploy | Superseded staging runtime and workflows | Deployment archaeology only | CLOSE_AFTER_PROOF |
| #37 | agent/finalize-chargeurs-platform | agent/chargenow-local-diagnostics | YES | NO | ChargeNow shadow/local gateway | Device shadow extraction and local gateway source | Runtime-only local-gateway-api/device-shadow-ingest may derive from it | High source-recovery relevance | EXTRACT |

## Required attention before any disposition change

### PR #335 — pricing/prepaid

Staging contains pricing V3/prepaid-related objects while the ledger and Git do
not provide one canonical history. Preserve tests, SQL and design evidence, but
do not merge the 84-commit branch before each runtime object and migration is
mapped. Active price profiles and immutable rental snapshots remain runtime
truth.

### PR #338 — Cloudflare

Extract separately:

1. pure Pages hosting;
2. kiosk proxy parity;
3. Volt/Workers AI;
4. ordinary auth fixes;
5. Android origin;
6. Supabase hardening/history;
7. Stripe/webhook changes;
8. diagnostics.

The public rescue C2 hardware action is not eligible for extraction into a
hosting PR.

### PR #301 — Android/Terminal

The source label and Stripe Terminal 5.8.0 configuration match DTA21277's
reported application label, but this is not source provenance. Preserve the
branch until the installed APK hash, signer and source commit are linked.

### Hardware/ejection/return family

PRs #136, #181, #202, #213, #254, #306 and #81 overlap. The canonicalization
unit is the invariant, not the newest PR:

- one payment authority;
- one release request;
- physical proof before final release state;
- return correlation independent of departure slot;
- quarantine on ambiguous inventory;
- idempotent reconciliation.

Each unique invariant must be diffed against main and the deployed functions
before any PR is closed.

## Closure rule

A PR may move to CLOSE_AFTER_PROOF only when:

- every unique commit/file is mapped to main, another retained PR or an explicit
  rejection;
- no deployed runtime, APK artifact, migration, workflow or runbook depends on
  its branch;
- the decision and evidence are recorded here;
- closing it does not delete the branch or historical artifact automatically.

Current action authorized by this document: **none**.
