# AGENT 7 — Supplier Catalog Staging Validation

## Environment

- Supabase project: `chargeurs-ch-staging`
- Project ref: `xqepbqnaenoeyfjkjnzl`
- Production: **not touched**

## Applied migration chain

The following Agent 7 migrations were applied successfully to staging:

1. `inventory_supplier_catalog_foundation`
2. `inventory_supplier_catalog_ingest_function`
3. `inventory_supplier_bajie_master_seed`
4. `inventory_supplier_bajie_page1_seed`
5. `inventory_supplier_bajie_page2_seed`
6. `inventory_supplier_bajie_page3_seed`
7. `inventory_supplier_bajie_page4_seed`
8. `inventory_supplier_bajie_page5_seed`
9. `inventory_supplier_bajie_page6_seed`
10. `inventory_supplier_bajie_page7_seed`
11. `inventory_supplier_catalog_fk_indexes`

Page 3 encountered one transient upstream connector HTTP 502 on the first attempt; retry succeeded. No partial-data workaround or manual catalog mutation was used.

## Real staging result

After migration, the database contains:

- suppliers: **1**
- source documents: **1**
- supplier contact targets: **7**
- generic product families: **9**
- product variants: **55**
- supplier products: **55**
- explicit supplier offers/configurations: **116**

## Invariant suite

`supabase/tests/inventory-supplier-catalog.sql` was executed inside a transaction and rolled back after assertions.

All assertions passed, including:

- exact catalog counts;
- `SUPPLIER_DECLARED` provenance preservation;
- all catalog-derived variants remain `candidate`;
- no negative supplier costs;
- no duplicate internal variant codes or supplier variant keys;
- distinct repeated-SKU configurations preserved for `ZBJ-166`, `BJD001` and `ZBJ-166-3`;
- exactly five page-6 `local_purchase` POS options;
- no invented `DC12V/10A` price for `ZBJ-SP-M`;
- no invented `IP54` row-level certification for `ZBJ-166-2`.

## Security posture

The Inventory catalog tables are RLS-enabled and intentionally have no client-facing RLS policies. Access is granted to `service_role` only. Supabase therefore reports the informational `rls_enabled_no_policy` lint, which matches this fail-closed server-only design.

No Inventory-specific warning reported the catalog ingestion function as anonymously or authenticated-user executable.

## Performance validation

The first advisor run identified five uncovered Inventory foreign-key paths. Dedicated indexes were added and applied. A second advisor run no longer reported those Inventory foreign keys as unindexed.

The new indexes may initially appear as `unused_index`, which is expected immediately after creating a new catalog domain and is not a reason to remove referential-support indexes before production query patterns exist.

## Runtime isolation

No migration in this workstream changes:

- `stations`;
- `slots`;
- `batteries`;
- rental sessions;
- pricing;
- payments / Stripe;
- kiosk runtime;
- Advertising;
- ChargeNow commands or hardware-control paths.

Supplier catalog data does not create owned assets and does not map a DTA station to a Bajie model without physical/supplier proof.
