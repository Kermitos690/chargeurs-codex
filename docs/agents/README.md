# Chargeurs Agent Operating System V2

Status: `CANONICAL GOVERNANCE PROPOSAL — DRAFT PR REQUIRED`

This directory documents logical responsibility owners for Chargeurs.ch. An
agent role is an ownership and handoff contract; it does **not** launch a Codex
subagent, create a paid dependency, or authorize work by itself.

## Read in this order

1. [Current Agent Registry](CURRENT_AGENT_REGISTRY.md) — verified current roles
   and launch recommendation.
2. [Ownership Matrix](OWNERSHIP_MATRIX.md) — exactly one primary owner per
   critical capability.
3. [Operating Model](OPERATING_MODEL.md) — dispatch, QA, release, physical
   truth, sources of truth, and subagent policy.
4. [Protected Core](PROTECTED_CORE.md) — protected boundaries and change gates.
5. [Handoff Protocol](HANDOFF_PROTOCOL.md) — the minimal cross-owner payload.
6. [Migration Report](MIGRATION_REPORT.md) — evidence, collisions, and work not
   performed by this governance change.

## Governing principles

```text
HUMAN DECIDES BUSINESS
GOVERNANCE CONTROLS OWNERSHIP
ONE OWNER EXECUTES
SPECIALISTS COLLABORATE ONLY WHEN NEEDED
EVIDENCE VALIDATES
RELEASE CONTROLS PRODUCTION
PHYSICAL REALITY OVERRIDES ASSUMPTION
GROWTH SELLS ONLY VERIFIED CAPABILITY
```

No document here overrides an explicit human business decision or the existing
cost-aware rules in the root `AGENTS.md`.
