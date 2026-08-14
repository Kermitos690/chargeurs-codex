# Operating Model

## 1. Dispatch and writers

Default execution is `ONE TASK -> ONE PRIMARY AGENT`. A0 identifies the domain
owner, records the active writer surface, and requests a handoff only when the
owner lacks authority or evidence.

There is one writer at a time per implementation surface. Parallel work is
allowed only when the surfaces and acceptance criteria are independent. A
read-only investigation does not grant write ownership.

If two roles claim a capability, mark `OWNERSHIP_COLLISION`, stop new work on
that collision, and let A0 with A1 recommend one owner and a handoff rule.

## 2. Subagent policy

`SUBAGENTS = 0` by default. The logical A0–A9 registry never creates running
Codex agents automatically.

An additional Codex subagent is allowed only when all are true:

1. the task is bounded and truly independent;
2. parallel work has a clear benefit over a single primary agent;
3. no writer surface overlaps;
4. it does not duplicate completed investigation; and
5. the dispatch records purpose, read/write scope, expected output, and cost
   risk.

Prefer read-only, narrow workers. Never launch A0–A9 in parallel merely because
those roles exist. No custom `.codex/agents/*.toml` files or local Skills are
introduced by this proposal.

Potential future workflow candidates are `bug-rca`, `protected-core-change`,
`release-validation`, `physical-validation`, and `agent-handoff`; a Skill is
only justified after repeated use proves that a compact document is insufficient.

## 3. Status model

Use exactly one current software status:

`BACKLOG`, `READY`, `IN_PROGRESS`, `BLOCKED`, `NEEDS_EVIDENCE`,
`HANDOFF_REQUIRED`, `READY_FOR_VALIDATION`, `VALIDATION_FAILED`, `VALIDATED`,
`READY_FOR_RELEASE`, `RELEASE_BLOCKED`, `RELEASED`, `ROLLED_BACK`, or
`CANCELLED`.

Record physical reality separately:

`SOFTWARE_ONLY`, `DEVICE_INSTALLED`, `PHYSICAL_TEST_REQUIRED`, or
`PHYSICALLY_VALIDATED`.

`PR_OPEN`, `MERGED`, `DEPLOYED`, `APK_BUILT`, `APK_INSTALLED`, `DB_MIGRATED`,
`EDGE_DEPLOYED`, and `PHYSICALLY_VALIDATED` are evidence facts, not synonyms.

## 4. QA contract

The recommended model is **Option B: an independent QA protocol without a new
logical Agent ID**, with A8 owning integration/release/physical gates.

| Gate | Writer | Required evidence | Validator |
| --- | --- | --- | --- |
| `DOMAIN_TESTED` | domain owner | targeted tests and their result | domain owner; A3 checks RCA fixes |
| `INTEGRATION_TESTED` | participating owner | integration result on exact candidate | A8 |
| `PHYSICAL_VALIDATED` | A8 with operator/device evidence | device, station, window, observed event and result | A8 |
| `READY_FOR_RELEASE` | A8 | complete release identity and all applicable gates | A8; human approves external/business risk |

An implementer may report tests but may not self-declare the release gate passed.
Failed QA returns to the owner through a handoff; it does not trigger an
opportunistic redesign.

## 5. Physical and release truth

The release manifest must bind the candidate to Git SHA, PR set, migrations,
Edge versions, web deployment, APK version/hash, station/device, test window,
and results. Provider HTTP acknowledgement is not physical ejection proof.

```text
CODE_EXISTS
-> TEST_PASSED
-> DEPLOYED
-> APK_INSTALLED
-> DEVICE_CONNECTED
-> PROVIDER_ACKNOWLEDGED
-> PHYSICAL_EVENT_OBSERVED
-> PHYSICALLY_VALIDATED
```

Each step requires its own evidence. A8 may set `RELEASE_BLOCKED` if a required
step is absent.

## 6. Source-of-truth registry

| Information | Canonical source of truth | Owner | Allowed projections |
| --- | --- | --- | --- |
| Pricing and customer segment quote | server-side pricing resolution and immutable snapshot | A2 | kiosk, web, account, receipts |
| Payment state | signed Stripe events plus server payment records | A2 | kiosk/account/admin status |
| Rental state | canonical server rental lifecycle/state version | A2 | kiosk, account, admin |
| Hardware command intent | persisted authorized server intent | A2 | admin/observability |
| Physical battery identity/event | correlated physical/provider event evidence | A2 for rental correlation; A7 for asset truth | kiosk/admin/inventory evidence |
| Inventory asset and readiness | serialized asset, location and supplier evidence | A7 | admin and capacity proposals |
| Campaign state | advertising campaign/playlist runtime | A5 | kiosk idle surface and analytics |
| Release identity | release manifest and exact artifacts | A8 | operations and growth readiness |
| Commercial pipeline | documented partnership records | A9 | planning only; never operational truth |

Two sources may coexist only with an explicit synchronization rule. A projection
may never silently replace canonical business or physical truth.

## 7. Business authority and cost

A human must decide price, deposit, caps, penalties, subscriptions, customer
terms, refunds, commercial commitments, and business model. Missing information
is `BUSINESS_DECISION_REQUIRED`, not permission to invent a value.

No incremental paid dependency is required by this operating model. Any proposal
for one is `COST_APPROVAL_REQUIRED` and must state recurring and one-off cost.
