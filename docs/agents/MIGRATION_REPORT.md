# Agent Operating System V2 — Migration Report

## Audit scope and evidence

Read-only audit, 2026-08-14. Baseline `main@703decf67504a466ac63b19e9933fc512e134ef3`.
Inspected: root `AGENTS.md`, relevant governance/kiosk documents, active GitHub
issues and PRs, and the current PR topology.

No product code, pricing, Stripe integration, database, APK, hardware,
deployment, migration, PR merge, or historical document deletion was performed.

## Findings

| Classification | Finding | Disposition |
| --- | --- | --- |
| `CANONICAL_CANDIDATE` | PR [#151] defines target Owner Map and Protected Core | absorb its principles here; do not auto-merge it |
| `CANONICAL_CANDIDATE` | PR [#150] defines Kiosk Target Architecture V4 | retain as architecture input; implementation stays A4-owned |
| `CONFLICTING` | overlapping return/settlement and hardware safety paths, including [#81] and [#136] | one owner path; no additive merge without A1/A2/A8 gates |
| `CONFLICTING` | Terminal work spans architecture [#169], Android [#167], backend [#168], and presentation work | A1 contract first; A8 has currently blocked integrated TEST RC |
| `STALE_OR_UNMERGED` | architecture docs are open PRs, not `main` truth | this proposal centralizes the operating rules without claiming those PRs are merged |
| `LEGACY_REQUIRED` | layered Kiosk presentation generations | A4 retires incrementally; do not stack new parallel presentation owners |
| `MISSING_GATE` | no compact canonical QA contract in root governance | resolved by Operating Model; A8 owns integration/physical gate |
| `MISSING_OWNER` | broad public-web/admin UI ownership remains unassigned in [#151] | keep unassigned until A0 selects an actual owner when work starts |
| `COST_RISK` | treating every A0–A9 role as a running subagent | resolved by explicit single-agent-first policy |

[#81]: https://github.com/Kermitos690/chargeurs-codex/pull/81
[#136]: https://github.com/Kermitos690/chargeurs-codex/pull/136
[#150]: https://github.com/Kermitos690/chargeurs-codex/pull/150
[#151]: https://github.com/Kermitos690/chargeurs-codex/pull/151
[#167]: https://github.com/Kermitos690/chargeurs-codex/pull/167
[#168]: https://github.com/Kermitos690/chargeurs-codex/pull/168
[#169]: https://github.com/Kermitos690/chargeurs-codex/pull/169

## Role migration decision

`AGENT_ROLE_MIGRATION_REQUIRED` is **not** triggered. The verified roster is
consistent with A2 as backend/pricing/payment and A6 as motion/3D. Reassigning
either based on a theoretical QA/Core Platform model would contradict active
program evidence and is not applied.

## Recommended next governance action

Review this Draft PR against #150 and #151. If accepted, treat this directory as
the concise canonical router and mark future superseded governance material with
`SUPERSEDED_BY` rather than deleting it. Resolve actual product collisions in
their domain PRs; this governance change must not merge or rewrite them.
