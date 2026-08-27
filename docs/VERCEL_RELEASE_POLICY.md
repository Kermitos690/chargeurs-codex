# Chargeurs.ch Vercel release policy

## Goal

Keep the Chargeurs.ch kiosk web app deployable on Vercel Hobby without spending deployment quota on ordinary development commits, pull requests, retries, or documentation changes.

## Development branches

Use branches and pull requests for normal work. Commits on branches are code-review and CI events only; they are not release events.

`vercel.json` deliberately sets `git.deploymentEnabled` to `false`, so Vercel Git integrations must not create automatic Preview or Production deployments for pushes.

## Main branch

Merging to `main` updates the canonical source code but does not by itself publish the kiosk web app.

Do not create empty, `noop`, `retry`, `retrigger`, or `force deploy` commits solely to make Vercel build again.

## Explicit release

A kiosk release is intentional and happens only through the `Direct Vercel kiosk release` GitHub Actions workflow.

The workflow can be started manually with `workflow_dispatch`, or through the legacy `.deploy/direct-vercel-kiosk-release` trigger file while that compatibility path is still needed.

The release workflow:

1. checks out `main`;
2. installs dependencies;
3. runs TypeScript and the production build;
4. links the canonical Vercel project;
5. builds a prebuilt production artifact;
6. deploys that artifact explicitly with the Vercel CLI;
7. records the release result.

Only one direct release workflow is allowed to run at a time.

## Quota incident behavior

If Vercel reports a deployment/build rate limit, do not create retry commits. Wait for the rolling quota window to recover, then run one explicit release of the latest validated `main`.

If Vercel reports `Account is blocked`, treat that separately from a deployment rate limit. Verify the owning Vercel team/project and account status before attempting another release.

## Current ownership warning

The direct release workflow currently targets:

- `VERCEL_ORG_ID=team_abDGf3iEKUokzMPUB580flN0`
- `VERCEL_PROJECT_ID=prj_2LXcZhvgaFe1sJp76xX05S3iQazM`

These identifiers are deployment configuration, not credentials. Before the next production/staging publication, positively verify that this team/project is the intended canonical Chargeurs.ch staging target and that the Vercel account owning it is active.
