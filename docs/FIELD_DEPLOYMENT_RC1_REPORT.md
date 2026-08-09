# FIELD_DEPLOYMENT_RC1 report

## Verdict

`FIELD_DEPLOYMENT_RC1 = FAIL`

The branch includes meaningful P0 corrections, but they have not been applied
to a migration-aligned staging project and the end-to-end financial/hardware
lifecycle is not proven.

## Evidence level

| Area | Status |
|---|---|
| Canonical reconciliation | IMPLEMENTED |
| Callback canonicalization | IMPLEMENTED, AUTOMATED_TESTED |
| Monotone state guard | IMPLEMENTED, AUTOMATED_TESTED |
| Atomic slot reservation | IMPLEMENTED, not INTEGRATION_TESTED |
| Selected-slot stability during Checkout | IMPLEMENTED, AUTOMATED_TESTED |
| C4/C7/C8 aggregation | IMPLEMENTED, AUTOMATED_TESTED |
| Stripe Checkout QR Test | previously STRIPE_TESTED, current RC not DEPLOYED_STAGING |
| Stripe webhook to final settlement | not proven |
| Exactly-once ejection | safety design present, not proven on RC |
| Return/reconciliation | not proven end-to-end |
| Android RC signing/boot recovery | not proven |
| FR/EN/DE primary kiosk | IMPLEMENTED; full journey not revalidated on RC |

## Blocking checklist

- [x] canonical branch reconciled
- [ ] staging migration set aligned and verified
- [ ] web/Edge/APK SHA trace proven on DTA21269
- [ ] callback succeeds from ChargeNow with a canonical URL
- [ ] concurrent reservation integration test
- [ ] Test payment -> callback -> one ejection intent -> physical reconciliation
- [ ] Test return -> final price -> settlement/refund -> receipt
- [ ] WebView restart and Android reboot recovery
- [ ] signed 1.0.16-rc1 installation/upgrade proof
- [ ] incidents visible to an operator

No ChargeNow mutation, ejection or real payment was sent during this RC code
work. A future physical test must wait for the exact human checkpoint required
by the mission.

## Local validation on current RC head

- `npm run typecheck`: PASS.
- `npm test -- --run`: PASS (31 files, 109 tests).
- `deno test --allow-env supabase/functions/tests/chargenow_callback_auth.test.ts supabase/functions/tests/cabinet_snapshot.test.ts`: PASS (15 tests).
- `npm run lint`: PASS with 15 pre-existing Fast Refresh warnings and no errors.
- `npm run build`: PASS (with the existing Vite oversized-chunk warning).
- `supabase db lint --linked`: PASS; it does not apply or validate the new migration against the remote history.

These results are AUTOMATED_TESTED only. They do not establish a staging,
tablet, Stripe, hardware or field proof for this RC.
