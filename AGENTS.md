# Cost-aware development rules

These rules are mandatory for every agent and contributor working in this repository.

- Start feature work in a draft pull request.
- Batch related changes before pushing; do not create empty, WIP, Changes, TEMP, bad, noop, or trigger-only commits.
- Never add automatic push triggers for feature, agent/**, or integration branches.
- Pull-request CI must skip draft PRs and run when marked ready, manually dispatched, and after merge to main.
- Use narrow path filters so unrelated modules do not start each other's workflows.
- Every automatic workflow must use concurrency with cancel-in-progress: true.
- Run cheap fail-fast checks before expensive checks.
- Do not use continue-on-error for required checks.
- Prefer one sequential job unless parallel execution has a documented benefit greater than its runner cost.
- Use caches and deterministic installs such as npm ci --no-audit --no-fund --prefer-offline.
- Upload artifacts only on failure and retain them briefly.
- Database, browser E2E, Android, Wallet, deployment previews, migrations, and production operations must be targeted and run only when relevant.
- Production or staging writes must remain manual with explicit confirmation.
- Prefer the application platform's cron/job system over GitHub runners when equivalent.
- Document expected monthly runs before adding a schedule and use the lowest useful frequency.
- Do not create self-modifying or one-shot workflows that commit and push code.
- Do not add or broaden a GitHub Actions trigger without documenting its monthly cost impact.
- Reuse existing workflows instead of creating overlapping workflows.
- Close superseded PRs and neutralize obsolete branches.
- Re-run only failed jobs, never an entire successful pipeline.
