# Cost-aware development rules

These rules are mandatory for every agent and contributor working in this repository.

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
