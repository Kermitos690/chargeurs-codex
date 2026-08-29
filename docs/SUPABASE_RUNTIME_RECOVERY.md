# Supabase runtime source recovery register

Status date: **2026-08-29**
Staging project: `xqepbqnaenoeyfjkjnzl` (`chargeurs-ch-staging`)

This register records source recovered from the deployed Supabase staging
runtime. Recovery into Git is **not** a deployment and does not prove that the
recovered bundle is the desired target architecture. Runtime code is preserved
before any cleanup so that convergence never destroys unique behavior.

## Recovery rule

For every runtime-only Edge Function:

1. capture the runtime function metadata and bundle hash;
2. preserve its deployed files without semantic cleanup;
3. record effective authorization and known callers where evidence exists;
4. keep runtime and Git unchanged semantically until a separate reviewed
   convergence decision is made;
5. never redeploy a recovered bundle merely because it has been committed;
6. never delete a runtime function merely because its name looks temporary.

## `noop` — recovered runtime v20

The runtime function named `noop` is **not a no-op** and must not be treated as a
diagnostic/retirement candidate based on its name.

| Fact | Evidence / value |
|---|---|
| Runtime slug | `noop` |
| Runtime status | `ACTIVE` |
| Runtime version | `20` |
| `verify_jwt` | `false` |
| Runtime bundle SHA-256 | `76977b4711e4a38cf94557a51f8ae289024632fd82a080b3dbdf79df7928dd76` |
| Runtime function id | `16fae65e-fe3c-4a70-96d2-be2a9b286832` |
| Runtime source before recovery | absent from `main` |
| Historical path in `main` | no commits found for `supabase/functions/noop/index.ts` |
| Classification | `OPERATIONS` + `WALLET` |
| Effective auth | custom dispatch secret checked in function body; service-role client used internally |
| Known caller | PostgreSQL Cron job `chargeurs-plus-push-outbox` |
| Schedule | every 5 minutes |
| Retirement disposition | `KEEP / SOURCE_RECOVERY_REQUIRED` |

### Recovered files

The exact runtime bundle consisted of:

- `supabase/functions/noop/index.ts`
- `supabase/functions/noop/_shared/passStudio.ts`
- `supabase/functions/noop/_shared/guestWallet.ts`

The helper files are intentionally kept **local to `noop`**. The runtime
`_shared/passStudio.ts` differs from the current repository-global
`supabase/functions/_shared/passStudio.ts`, while the runtime
`_shared/guestWallet.ts` did not exist in the repository-global shared source.
Moving or deduplicating them during recovery would alter evidence and is therefore
out of scope.

### What `noop` actually does

The deployed v20 bundle contains real operational logic for:

- Web Push notification outbox dispatch;
- VAPID delivery and subscription failure handling;
- customer Wallet synchronization outbox processing;
- native Wallet notification processing;
- PassStudio instance synchronization/push controls;
- service-role database access;
- transactional row claiming/retry/idempotence behavior.

It accepts POST only and validates the supplied dispatch key against the
server-side `customer_push_dispatch_key` secret before processing. `verify_jwt`
being false therefore does not mean the runtime endpoint is intentionally
unauthenticated.

No secret values are stored in this recovery register or recovered source.

### Current staging activity

Read-only staging checks on 2026-08-29 showed:

- active Web Push subscriptions: `0`;
- Web Push notifications created in the last 30 days: `0`;
- Web Push notifications sent in the last 30 days: `0`;
- pending Web Push notifications: `0`;
- pending Wallet sync rows: `13`;
- pending native Wallet notification rows: `10`.

Current runtime feature settings also report:

- `customer_wallet.pass_studio_instance_sync.enabled = false`
  (`provider_push_is_billable`);
- `customer_wallet.pass_studio_push.enabled = false`
  (`pre_production_zero_cost_hardening`).

Therefore the five-minute cron currently has no observed active Web Push work,
and the PassStudio-dependent Wallet work is intentionally disabled. That makes
its present invocation cadence a **cost-optimization candidate**, but it does
not make the function itself disposable.

At a five-minute cadence, this cron alone has a theoretical baseline of **8,640
Edge Function invocations per 30-day month**.

Any pause, cadence reduction or rename of this job/function requires a separate
reversible runtime change with a rollback command and reactivation criteria.
It is not performed by source recovery.

## Inventory correction

Until `docs/SUPABASE_FUNCTION_INVENTORY.md` is regenerated from the recovered
source set, this document is the authoritative override for the `noop` row.
The old classification `DIAGNOSTIC / retirement candidate` is superseded by:

`noop = OPERATIONS + WALLET / KEEP / SOURCE RECOVERED FROM RUNTIME V20`

After this recovery is merged, expected source/runtime inventory counts become:

- staging runtime functions: `100` (unchanged);
- Git function directories: `60` (was 59);
- common runtime + Git names: `59` (was 58);
- runtime-only functions: `41` (was 42);
- Git-only functions: `1` (unchanged).

These counts are source inventory only. No Supabase function is deployed,
deleted, renamed or modified in staging by this recovery.

## Remaining runtime-only recovery work

The other runtime-only functions remain `UNKNOWN` until their deployed source,
authorization and caller dependencies are captured. Recovery should proceed in
small batches, prioritizing:

1. scheduled/background functions;
2. public `verify_jwt=false` functions;
3. hardware/payment capable functions;
4. functions with active external callbacks;
5. one-shot/diagnostic functions before any retirement decision.

No mass recovery should be followed by a mass deploy. Runtime/source semantic
comparison comes first.
