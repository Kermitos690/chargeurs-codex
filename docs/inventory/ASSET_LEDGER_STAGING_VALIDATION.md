# AGENT 7 — Asset / Location / Movement Ledger — Staging Validation

## Environment

- Supabase project: `chargeurs-ch-staging`
- Project ref: `xqepbqnaenoeyfjkjnzl`
- Production: **not touched**
- Branch: `agent/inventory/asset-ledger`

## Purpose

Validate that Chargeurs.ch can maintain a serialized Inventory projection of real runtime hardware without modifying the runtime `stations`, `slots` or `batteries` tables, without commanding hardware, and without inventing ownership, supplier-model mappings or historical movements.

## Applied migration

- `inventory_asset_location_ledger`

The migration creates:

- `inventory_locations`;
- `inventory_assets`;
- `inventory_asset_identifiers`;
- `inventory_asset_movements`;
- `inventory_runtime_observations`;
- `inventory_record_asset_movement(...)`;
- `inventory_reconcile_runtime_hardware(...)`.

All Inventory tables are RLS-enabled and server-only (`service_role`).

## Real reconciliation result

`inventory_reconcile_runtime_hardware(['DTA21269','DTA21277','DTA22032'])` returned:

- station assets observed: **3**;
- powerbank assets observed: **8**;
- location conflicts: **0**;
- ownership state: **unknown**;
- supplier/model mapping: **unknown**.

After reconciliation the Inventory domain contains:

- total serialized assets: **11**;
- station assets: **3**;
- powerbank assets: **8**;
- locations: **11**;
- slot locations: **4**;
- runtime observations: **11**;
- powerbanks with physical location unknown: **5**;
- powerbanks in quarantine: **2**;
- fabricated historical movements: **0**.

## Current physical-location projection

### DTA21269

Observed runtime slots:

- slot 1: empty / return-capable;
- slot 2: `F0F000503E`;
- slot 3: `FECA02C714`;
- slot 4: `F0F0004944`.

Inventory therefore projects:

- `PB-F0F000503E` → `SLOT:DTA21269:2`;
- `PB-FECA02C714` → `SLOT:DTA21269:3`;
- `PB-F0F0004944` → `SLOT:DTA21269:4`.

### Powerbanks not currently matched to a unique slot

The following assets are intentionally assigned to `UNLOCATED` rather than inventing a warehouse, workshop or other physical location:

- `PB-F0F00045BB`;
- `PB-F0F00045BC`;
- `PB-F0F00048E0`;
- `PB-F0F0004F21`;
- `PB-FECA0240D9`.

## Quarantine preservation

Two runtime battery records are currently projected as Inventory `quarantined`, not automatically `defective`:

- `FECA02C714` — runtime reason `suspected_battery_fault_charge_drop`;
- `F0F0004F21` — runtime reason `provider_order_create_2009_repeated`.

The second reason is not assumed to be a battery hardware defect. Inventory preserves the quarantine state and evidence only.

## Identity / ownership safety

For all runtime-created assets:

- `ownership_state = unknown`;
- `product_variant_id = NULL`;
- `supplier_product_id = NULL`;
- runtime station ID / battery ID is stored as an observed identifier, not a manufacturer serial;
- no DTA asset is mapped to a Bajie supplier model by visual similarity or assumption.

## Movement ledger validation

`supabase/tests/inventory-asset-ledger.sql` was executed on staging.

The test transactionally created a `MANUAL_CORRECTION` movement for `F0F000503E`, replayed the same idempotency key, and verified:

- first call creates one movement;
- second call is reported as an idempotent replay;
- only one movement row exists for the idempotency key;
- the entire movement test is rolled back afterward.

Persistent movement count therefore remains **0**: no historical movement has been fabricated from a current-state snapshot.

## Security / performance checks

Supabase security advisor reports the Inventory tables as `rls_enabled_no_policy` INFO, which is intentional for this server-only domain. No new Agent 7 `SECURITY DEFINER` function is reported as executable by `anon` or ordinary `authenticated` users.

The performance advisor reports no unindexed foreign-key warning for the new Asset/Location/Ledger tables. Newly created indexes can appear as `unused_index` immediately after deployment, which is expected before production query traffic exists.

## Cross-domain finding

The advisor does report an existing runtime function, `public.sync_battery_location_from_slot()`, as callable by `anon` / `authenticated` while using `SECURITY DEFINER`. Agent 7 does **not** modify it because it owns the runtime `slots` → `batteries` projection, not the Inventory domain. A cross-domain review request must be raised separately.

## Result

The Asset/Location foundation has produced real, queryable staging inventory while preserving the critical boundary:

**runtime hardware observation → Inventory evidence**, never **Inventory → hardware command**.
