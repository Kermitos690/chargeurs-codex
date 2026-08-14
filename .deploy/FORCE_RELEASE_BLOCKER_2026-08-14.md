# FORCE RELEASE BLOCKER — 2026-08-14

Target candidate: `agent/kiosk-ux/dta21269-pricing-first-progress-v1@5ea85c6c12ab828311a6b34eee341d98d193fa22`
Pricing functional parent: `24a286016ddf764c138c07b60ba2da81d3308860`

Agent 0 requested an immediate canonical staging release for the online DTA fleet.

The branch-specific release workflow was executed as GitHub Actions run `31810273222` and failed before build/deploy because repository Actions secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID` are all empty.

No pricing/backend failure is implicated by this release failure.

Current staging fleet routing has been cache-busted server-side for the online numeric DTA stations so that, once the canonical staging deployment is promoted, they request the new bundle immediately:
- DTA21269
- DTA21277
- DTA22032

Do not merge unrelated product branches merely to bypass this deployment credential blocker. Restore/configure the Vercel Actions credentials or promote the exact #189 Vercel deployment through the authenticated Vercel project, then Agent 8 must verify the canonical domain serves the new bundle before payment/ejection testing.
