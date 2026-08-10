# Field Deployment RC1 — staging schema deployment

Date: 2026-08-09

## Scope

This report records the controlled Supabase staging schema deployment for the Chargeurs.ch Field Deployment RC1. It does not claim unattended-field readiness, Stripe Live readiness, or a physically verified ejection/return cycle.

Staging project: `xqepbqnaenoeyfjkjnzl` (`chargeurs-ch-staging`)

Branch: `codex/field-deployment-v1`

Pilot cabinet: `DTA21269`

## Safety constraints used

- No database reset.
- No destructive business-data migration.
- No Stripe Live operation.
- No ChargeNow hardware mutation.
- No ejection command.
- Temporary schema-test rows were isolated and deleted after validation.

## Migrations applied to staging

The migration ledger had first been reconciled so there were no unexplained remote-only historical migrations. The following RC migrations were then applied:

- `20260809024615_kiosk_numeric_enrollment_rate_limits.sql`
- `20260809024640_harden_public_rpc_access.sql`
- `20260809024701_expand_platform_role_matrix.sql`
- `20260809024733_field_deployment_state_and_reservations.sql`
- `20260809025310_field_deployment_rpc_acl_hardening.sql`
- `20260809025742_field_deployment_atomic_insert_reservation.sql`

Repository migration filenames were aligned to the actual staging-applied versions. Earlier timestamp variants that had never been applied to staging were removed from the RC branch.

## Database invariants now active

### Monotone rental state

`rental_sessions.state_version` is database-owned. A forward state transition increments it. A stale regression is rejected by the trigger.

Validation:

- `created -> payment_succeeded -> ejecting -> ejected`: PASS.
- observed version after three transitions: `3`.
- attempted `ejected -> ejecting`: PASS (rejected with `RENTAL_STATE_REGRESSION`).

The only scoped backward-looking test resume is `needs_support -> ejecting` after a prior `HARDWARE_EJECTION_DISABLED`, and only while an exact unconsumed one-time permit exists for the same rental, station and slot.

Validation:

- resume without permit: PASS (rejected).
- resume with exact scoped permit: PASS.

### Atomic slot reservation

`station_slot_reservations` has one active reservation per `(station_id, slot_num)`.

A database trigger now creates the reservation in the same transaction as every future `rental_sessions` insert that contains a concrete slot. This protects both the preferred reservation RPC and currently deployed Edge Function code paths.

Validation:

- rental insert with a slot automatically creates one reservation: PASS.
- a second active rental insert for the same station and slot: PASS (rejected atomically).
- a uniqueness failure aborts the second rental insert; it cannot leave an unreserved paid-intent session behind.

### Internal RPC ACLs

`create_reserved_kiosk_rental_session(jsonb)` and `transition_rental_session(...)` are not executable by `anon` or `authenticated`.

Validated ACL: postgres/service-role only.

The public kiosk projections (`kiosk_quote`, `kiosk_session_status`) remain intentionally callable through their narrow bearer-capability validation and do not expose raw provider or Stripe secrets.

## Current deployed rental-session Edge Function

Staging `create-rental-session` version 19 was inspected after the schema deployment.

It already:

- requires a station-bound `X-Kiosk-Token`;
- requires `selectedSlotNum` to be a positive physical slot number;
- re-reads a fresh multi-source ChargeNow snapshot (C4/C7/C8/O1) at reservation time;
- refuses a selected slot unless the aggregated snapshot marks it rentable;
- computes pricing server-side;
- stores the selected slot and battery identity;
- uses an idempotency key for the customer intent.

It still inserts `rental_sessions` directly rather than calling the newer reservation RPC, but `20260809025742` now enforces the same atomic physical-slot reservation invariant at the database boundary for that direct insert path.

## DTA21269 preservation

After the migration and temporary schema tests, the DTA21269 station row remained present. At the time of verification the normalized database state was:

- status: `online`
- online: `true`
- total_count: `4`
- rentable_count: `4`
- returnable_count: `0`

The last synchronized provider timestamp was older than the RC work session. Those counts are therefore not accepted as proof of current battery eligibility; a fresh C4/C7/C8/O1 snapshot is required immediately before the next rental test.

## Business table preservation

Critical business-row counts were checked before/after the deployment. No business rows were lost. The only observed count increase was normal diagnostic logging (`api_logs`).

Post-validation counts included:

- stations: 4
- slots: 4
- batteries: 8
- rental_sessions: 49
- payments: 46
- kiosk_devices: 4

## Kiosk 16:9 UI branch change

The RC branch also contains an edge-to-edge kiosk canvas change in `src/index.css`:

- kiosk `html`, `body` and `#root` have zero outer margin/padding;
- `.kiosk-root` is fixed to the full viewport (`100vw`, `100vh`/`100dvh`);
- the main landscape stage has no outer frame/gutter;
- the previous rounded inset border on the 16:9 DTA landscape screen is removed;
- internal touch-safe spacing remains inside controls, but there is no page margin around the customer surface.

This is committed but must still be visually verified on the real tablet after the web build containing the branch is deployed.

## Not yet proven

The following remain separate acceptance gates:

- exact web/Vercel deployment SHA on the tablet;
- new signed RC APK installation/identity;
- fresh DTA21269 multi-source battery snapshot at test time;
- real ChargeNow callback delivery after the callback-auth fix;
- Stripe Test payment through the current RC deployment;
- one controlled physical ejection;
- automatic return reconciliation;
- final pricing/settlement/refund;
- reboot/WebView crash recovery;
- full FR/EN/DE tablet journey;
- operator incident/alert delivery.

## Current schema verdict

`RC_SCHEMA_READY = YES`

The staging schema now enforces monotone session state and atomic concrete-slot reservation for both the preferred RC RPC path and the currently deployed direct-insert rental-session path. This does not by itself make the station field-ready.
