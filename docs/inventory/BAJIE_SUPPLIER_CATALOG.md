# AGENT 7 — Bajie Supplier Catalog v1

## Status

Source status: `SUPPLIER_DECLARED`.

This document records the normalization rules used for the user-provided 7-page **BAJIE CHARGING Quotation** from Shenzhen Bajie Charging Technology Co., Ltd.

Catalog presence does **not** mean that Chargeurs.ch owns, has tested, has approved, or can safely deploy a referenced product.

Supplier prices are catalog hardware prices in USD. They are **not** landed costs in Switzerland and must never be reused as customer pricing.

## Supplier master

- Legal name: Shenzhen Bajie Charging Technology Co., Ltd.
- Trade name: BAJIE CHARGING
- Country: China
- Website declared by supplier: `www.bajie-charging.com`
- Address declared by supplier: Building 5, 2nd-4th Floors, Fuzhong Industrial Park, Huaide Community, Fuyong Subdistrict, Shenzhen
- Quotation date: `UNKNOWN` — the supplied PDF does not show one.
- Commercial remark: tax, freight and software are excluded; hardware only.

## Contact targets

The quotation only says to contact the business manager; it does not identify a named person, email, telephone number, technical engineer or RMA contact. Agent 7 therefore tracks the following contact targets without inventing contact data:

- `sales_business_manager` — role mentioned, direct contact unknown;
- `technical_hardware` — UNKNOWN;
- `spare_parts` — UNKNOWN;
- `after_sales_rma` — UNKNOWN;
- `firmware_software` — UNKNOWN;
- `logistics_export` — UNKNOWN;
- `certification_compliance` — UNKNOWN.

## Catalog scope extracted

The normalized ingestion covers **55 catalog entries**:

- 3 shared powerbanks;
- 8 desktop charging stations with ADS;
- 9 desktop charging stations without a quoted ADS screen;
- 9 floor-standing charging stations with ADS;
- 3 rows from the waterproof-station section;
- 4 modular charging-station accessories;
- 3 stands;
- 10 POS/payment hardware options shown on page 6;
- 6 POS/station accessories shown on page 6.

The source quotation contains **116 explicit priced offers/configurations** after quantity/configuration normalization.

## Important normalization rules

1. `supplier_sku` is preserved exactly when a model code is present.
2. Repeated supplier model numbers are **not merged** when the quotation presents materially different configurations. Examples include `ZBJ-166`, `BJD001` and `ZBJ-166-3` touch/non-touch configurations.
3. Supplier-declared specifications remain JSON supplier specifications until independently verified.
4. `Stripe BBPOS WisePad 3`, `Stripe M2`, `Dejavoo QD1`, `SumUp Plus` and `myPOS Go 2` are shown as **Local purchase** options. They are catalog options, not asserted Bajie-manufactured products.
5. `ZBJ-SP-M` declares `DC12V/10A` support but the quotation shows no corresponding price. Price remains `UNKNOWN` and requires supplier confirmation.
6. The row `ZBJ-166-2` appears inside the waterproof section, but the row itself does not explicitly show `Outdoor waterproof` or `IP54`. Agent 7 therefore does not silently promote it to verified IP54 compatibility.
7. Payment-method text in the supplier quotation is stored only as supplier-declared hardware/catalog metadata. It does not change Chargeurs.ch payment architecture.
8. ADS/display fields are catalog hardware specifications only. Advertising runtime ownership remains with AGENT 5.

## Separation from runtime inventory

Existing `stations`, `slots` and `batteries` tables remain runtime/provider projections. The new `inventory_*` supplier catalog tables do not modify them.

No supplier catalog row creates an owned asset. Asset ownership, serial-number mapping, stock ledger, purchase orders, receipts, RMA and maintenance lifecycle are later Agent 7 workstreams.

## Next supplier questions

Before declaring BOM or spare-part compatibility, request from Bajie:

- complete spare-parts catalog with SKU and unit pricing;
- exploded drawings / BOM per station model and hardware revision;
- slot mechanism / ejector / lock part numbers;
- controller PCB and charging-board references;
- PSU references and electrical compatibility;
- touchscreen/display panel references;
- 4G/WiFi communication-module references;
- harness/cable/connector references;
- warranty duration and exclusions;
- DOA and RMA procedure;
- standard repair lead time;
- firmware/protocol ownership and version compatibility;
- exact powerbank ↔ station compatibility matrix;
- CE/FCC/RoHS/MSDS/UN38.3/IP54 certificate files corresponding to each quoted model;
- Incoterms, production lead times, export packaging and freight options to Switzerland.

Until those answers are received, compatibility and spare-part claims remain `UNKNOWN` or `REQUIRES_SUPPLIER_CONFIRMATION`.
