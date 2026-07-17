# Manual CI visibility

The workflow `.github/workflows/manual-ci.yml` is intentionally manual-only and must exist on the default branch so GitHub exposes it in the Actions sidebar and allows selecting a target branch for `workflow_dispatch`.

It does not run automatically and is used to validate coherent batches while controlling GitHub Actions cost.
