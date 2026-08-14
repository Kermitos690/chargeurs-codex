# Current Agent Registry

Audit baseline: `main@703decf67504a466ac63b19e9933fc512e134ef3`, 2026-08-14.
Evidence includes the open master program [#114], target architecture [#151],
and related active issues/PRs. This is a role registry, not a list of running
Codex processes.

| ID | Current mission and primary domain | Verified references | Write surface / boundary | Status | Launch recommendation |
| --- | --- | --- | --- | --- | --- |
| A0 | Multi-agent WIP, dependencies, collisions, dispatch and handoffs | [#114], [#151] | Governance boards and handoff records; no feature implementation by default | `ACTIVE_CORE` | `KEEP` |
| A1 | Product architecture, cross-domain contracts and Protected Core architecture | [#119], [#150], [#151], [#169] | Architecture/governance documents; not feature UI, payment, rental or hardware code | `ACTIVE_CORE` | `KEEP` |
| A2 | Backend, pricing, payment and Stripe contracts | [#114], [#151], [#168] | Server pricing/payment contracts and tests; not kiosk presentation or supplier behavior | `ACTIVE_CORE` | `KEEP` |
| A3 | Bug Hunter: RCA, first divergence and minimal safety corrections | [#55], [#85], [#92], [#102], [#111] | Incident/RCA and the handed-off corrective surface; no opportunistic redesign | `ACTIVE_CORE` | `KEEP` |
| A4 | Kiosk UX, interaction, navigation and presentation | [#105], [#150], `docs/agent4-kiosk-auth-failsafe-plan.md` | Kiosk presentation and UX tests; never pricing, payment, rental or hardware truth | `ACTIVE_CORE` | `KEEP` |
| A5 | Advertising runtime, campaign/media/playlist behavior | [#151] | Ads runtime and ads tools; cannot block a rental path | `ACTIVE_ON_DEMAND` | `KEEP_ON_DEMAND` |
| A6 | Creative technology, 3D and motion primitives | [#82], [#151], [#170] | Presentation-only visual primitives; no navigation, payment, hardware or success semantics | `SPECIALIST_ON_DEMAND` | `KEEP_ON_DEMAND` |
| A7 | Inventory, supply chain and hardware asset truth | [#108], [#151] | Supplier facts, serialized assets, inventory/admin Inventory; not rental transitions or ejection commands | `ACTIVE_ON_DEMAND` | `KEEP_ON_DEMAND` |
| A8 | Integration, release identity and physical validation | [#110], [#151], [#171] | Release manifest, integration evidence and physical QA; no feature development by default | `ACTIVE_CORE` | `KEEP` |
| A9 | Growth and partnerships | [#151] | Commercial pipeline and verified-capability proposals; cannot set price, capacity or readiness | `ACTIVE_ON_DEMAND` | `KEEP_ON_DEMAND` |

[#55]: https://github.com/Kermitos690/chargeurs-codex/issues/55
[#82]: https://github.com/Kermitos690/chargeurs-codex/issues/82
[#85]: https://github.com/Kermitos690/chargeurs-codex/issues/85
[#92]: https://github.com/Kermitos690/chargeurs-codex/issues/92
[#102]: https://github.com/Kermitos690/chargeurs-codex/issues/102
[#105]: https://github.com/Kermitos690/chargeurs-codex/issues/105
[#108]: https://github.com/Kermitos690/chargeurs-codex/issues/108
[#110]: https://github.com/Kermitos690/chargeurs-codex/issues/110
[#111]: https://github.com/Kermitos690/chargeurs-codex/issues/111
[#114]: https://github.com/Kermitos690/chargeurs-codex/issues/114
[#119]: https://github.com/Kermitos690/chargeurs-codex/issues/119
[#150]: https://github.com/Kermitos690/chargeurs-codex/pull/150
[#151]: https://github.com/Kermitos690/chargeurs-codex/pull/151
[#168]: https://github.com/Kermitos690/chargeurs-codex/pull/168
[#169]: https://github.com/Kermitos690/chargeurs-codex/pull/169
[#170]: https://github.com/Kermitos690/chargeurs-codex/pull/170
[#171]: https://github.com/Kermitos690/chargeurs-codex/issues/171

## Handoff and validation targets

| From | Normal handoff targets | Validation role |
| --- | --- | --- |
| A0 | any owner; A1 for contract conflict; A8 for release | WIP/collision acceptance |
| A1 | A0, A2, A4, A7, A8 as contract requires | Cross-domain contract acceptance |
| A2 | A3 for RCA, A4 for projection, A8 for integration | Domain tests and Protected Core evidence |
| A3 | actual domain owner; A8 for release evidence | RCA evidence and minimal-fix scope |
| A4 | A2/A3 for truth divergence; A5/A6 for presentation support; A8 for field QA | Kiosk presentation acceptance |
| A5 | A4 for kiosk surface contract; A8 when release-relevant | Ads isolation evidence |
| A6 | A4 for integration; A8 for physical/performance evidence | Visual degradation and performance evidence |
| A7 | A2/A3 for runtime evidence; A8 for field readiness; A9 for capacity | Asset/supplier evidence |
| A8 | A0 for release decision; actual owner for failed gate | Integration and physical proof |
| A9 | A7 capacity; A1/A2 product contract; A8 readiness; human for terms/pricing | Verified-capability check |

## Explicit non-decisions

- No agent IDs are renumbered by this document.
- A6 is retained as an on-demand specialist; it is not a launch-critical
  continuously active lane.
- A9 is retained on demand. Its active implementation footprint must be
  re-verified before a broad growth stream starts.
- A dedicated new QA agent is not created. The QA contract is independent and
  uses A8 as the release/physical gate.
