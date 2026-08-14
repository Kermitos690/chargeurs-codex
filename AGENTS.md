# Cost-aware development rules

These rules are mandatory for every agent and contributor working in this repository.

## Agent Operating System

This file is the compact constitution and router for the Chargeurs Agent
Operating System. The canonical operating documents are in
[`docs/agents/`](docs/agents/README.md).

- An **Agent** is a logical domain owner. It is not a continuously-running
  Codex process and does not imply a separate model run.
- Default to **one primary agent and one writer per implementation surface**.
  Use a subagent only for a bounded, independent task with a documented benefit.
- Every important capability has one primary owner. Contributors may assist but
  do not acquire ownership merely by touching a file.
- An owner must hand work across domains with the compact contract in
  [`HANDOFF_PROTOCOL.md`](docs/agents/HANDOFF_PROTOCOL.md).
- Changes to Protected Core must be marked `PROTECTED_CORE_CHANGE` and satisfy
  the gates in [`PROTECTED_CORE.md`](docs/agents/PROTECTED_CORE.md). UI, Ads,
  Growth, and Inventory surfaces may not weaken a server-side safety invariant.
- `MERGED`, `DEPLOYED`, `APK_INSTALLED`, and `PHYSICALLY_VALIDATED` are distinct
  states. Only the release gate may declare `READY_FOR_RELEASE`.
- Business decisions (price, deposit, caps, refunds, terms, commercial promises,
  or business model) require explicit human approval: `BUSINESS_DECISION_REQUIRED`.
- No new paid AI service, multi-agent platform, SaaS monitoring, vector database,
  cloud service, or recurring LLM job may be added without
  `COST_APPROVAL_REQUIRED`.

For the current roster, ownership, QA and release model, and migration findings,
read the documents above before changing governance or cross-domain work.

## Default workflow

- Start feature work in a **draft pull request**.
- Batch related changes locally before pushing; do not create empty, `WIP`, `Changes`, or trigger-only commits.
- Never add automatic `push` triggers for feature, `agent/**`, or integration branches.
- Pull-request CI must skip draft PRs and run when the PR is marked ready, when manually dispatched, and after merge to `main`.
- Use `paths` or `paths-ignore` so unrelated code, documentation, Android, Wallet, database, and frontend changes do not start each other's workflows.
- Every automatic workflow must use `concurrency` with `cancel-in-progress: true`.

## CI design

- Run cheap fail-fast checks before expensive checks.
- Do not use `continue-on-error` for required lint, typecheck, tests, or builds.
- Prefer one sequential job unless parallel execution provides a documented benefit greater than its runner cost.
- Use dependency caches and deterministic installs such as `npm ci --no-audit --no-fund --prefer-offline`.
- Upload artifacts only on failure, retain them briefly, and never archive routine logs with `if: always()`.
- Database, browser E2E, Android builds, deployment previews, migrations, and production operations must be targeted and run only when relevant.
- Production/staging deployments and migrations must remain manual with explicit confirmation.

## Scheduled and one-shot automation

- Prefer the application platform's cron/job system over GitHub-hosted runners when it provides the same service.
- Before adding a scheduled GitHub workflow, document its expected runs per month and choose the lowest useful frequency.
- Do not create self-modifying or one-shot workflows that commit and push code. Use a reviewed script or a manual workflow, then remove it in the same reviewed change.

## Change control

- Do not add or broaden a GitHub Actions trigger without explaining the monthly cost impact in the PR.
- Reuse existing workflows rather than creating overlapping workflows for the same files.
- Close superseded pull requests and neutralize obsolete branch workflows.
- Re-run only failed jobs; do not restart an entire successful pipeline.
