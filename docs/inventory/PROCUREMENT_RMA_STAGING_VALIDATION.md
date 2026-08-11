# AGENT 7 — Procurement / Supplier Outreach / RMA Staging Validation

## Environment

- Supabase project: `chargeurs-ch-staging`
- Project ref: `xqepbqnaenoeyfjkjnzl`
- Production: **not touched**
- Git branch: `agent/inventory/procurement-rma`
- Base: `agent/inventory/defect-lifecycle`

## Real external supplier action

On 2026-08-11, Chargeurs.ch sent a real outbound email to the verified BAJIE general contact:

- To: `info@chargenow.top`
- Subject: `Chargeurs.ch Switzerland — Technical BOM, Spare Parts, RMA & White-Label Information Request`
- Gmail message id: `19fef3eb676f6ac9`
- Gmail thread id: `19fef3eb676f6ac9`

The request asks for technical evidence required by Agent 7 before spare parts, compatibility, RMA or landed-cost claims can be promoted.

### Requested evidence — 11 tracked requirements

1. complete spare-parts catalogue with SKU / price / MOQ / lead time;
2. BOM / exploded drawings and hardware revisions;
3. exact compatibility matrix;
4. core component SKUs and prices;
5. warranty / DOA / RMA procedure;
6. named technical / RMA / firmware / logistics / compliance / commercial contacts;
7. firmware / protocol documentation and version compatibility;
8. model-specific certificates;
9. Incoterms, lead times, export packaging and shipping to Switzerland;
10. OEM / white-label / reseller conditions for Switzerland;
11. confirmation of 2026 quotation validity or latest quotation.

All 11 items are persisted as `requested`. No answer is currently recorded as received or verified.

## Spare-parts request register

Nine component categories are now explicitly tracked against this inquiry:

- slot / ejector / locking mechanism;
- controller PCB;
- charging / slot PCB;
- power supply;
- display / touchscreen;
- 4G / Wi-Fi communication module;
- wiring / cables / connectors;
- enclosure / stand parts;
- powerbank service components, if supported.

Current evidence state:

- requested categories: **9**;
- supplier spare-part SKUs invented: **0**;
- supplier spare-part prices invented: **0**;
- compatibility claims invented: **0**.

This is intentional. The database is ready to receive supplier evidence without converting a request into a fact.

## Procurement foundation

The migration adds:

- `inventory_supplier_inquiries`;
- `inventory_supplier_inquiry_items`;
- `inventory_spare_part_requests`;
- `inventory_purchase_orders`;
- `inventory_purchase_order_lines`;
- `inventory_procurement_cost_components`;
- `inventory_receipts`;
- `inventory_receipt_lines`;
- `inventory_rma_cases`;
- `inventory_rma_events`.

No catalog row automatically creates a PO, receipt or asset.

### Real quoted-cost validation

A transaction-only test used the existing supplier-declared `ZBJ-SP04` sample offer:

- quoted hardware unit cost: **USD 121**;
- test quantity: **1**;
- calculated hardware subtotal: **USD 121**;
- known freight/import/brokerage/etc. components: **USD 0**;
- `landed_cost_status`: **unknown**.

The transaction was rolled back. Staging therefore contains:

- persistent purchase orders: **0**;
- persistent purchase-order lines: **0**;
- receipts: **0**;
- receipt lines: **0**.

This proves that a supplier hardware quote is not silently presented as Swiss landed cost and that test procurement data did not leak into the operational staging inventory.

## RMA guardrail — real FECA02C714 case

The existing suspected defect for `FECA02C714` now has exactly one internal RMA eligibility record:

- RMA status: `eligibility_unknown`;
- diagnostic status: `suspected`;
- supplier mapping: `NULL`;
- supplier-product mapping: `NULL`;
- submitted_at: `NULL`.

This is an internal eligibility hold only — not an RMA submission.

A staging attempt to advance that record to `submitted` was rejected by the database with:

`INVENTORY_RMA_DIAGNOSIS_REQUIRED`

After the rejected attempt the record remained unchanged at `eligibility_unknown`.

Therefore the database enforces the intended sequence:

`SUSPECTED -> DIAGNOSIS -> supplier/model proof -> RMA eligibility -> SUBMITTED`

and does not allow:

`SUSPECTED -> supplier RMA`

## Security proof

Direct privilege checks on the two new SECURITY DEFINER functions:

### `inventory_validate_rma_case()`

- `anon`: **cannot execute**;
- `authenticated`: **cannot execute**;
- `service_role`: **can execute**.

### `inventory_purchase_order_cost_summary(uuid)`

- `anon`: **cannot execute**;
- `authenticated`: **cannot execute**;
- `service_role`: **can execute**.

The new tables are RLS-enabled and server-only.

## Referential-performance proof

All foreign-key paths in the new Procurement / Receiving / RMA tables have covering indexes in staging.

## Current supplier-response state

A Gmail check immediately after sending found no incoming response from `info@chargenow.top` yet.

This is expected and does not change any requirement status.

## Domain isolation

This workstream does **not** modify:

- runtime `stations`;
- runtime `slots`;
- runtime `batteries`;
- ChargeNow commands;
- rental sessions;
- Stripe or pricing;
- Kiosk UX;
- Advertising;
- production.

## Next operational state transition

When BAJIE replies:

1. preserve the supplier response as source evidence;
2. update only the inquiry items actually answered;
3. create spare-part SKUs only where an explicit supplier SKU exists;
4. keep compatibility `supplier_declared` until independently validated where appropriate;
5. record warranty/RMA rules separately from operational defect diagnosis;
6. calculate landed cost only when freight/import/cost evidence is available;
7. never map current DTA hardware to a BAJIE model solely because BAJIE is a supplier candidate.
