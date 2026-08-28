# Chargeurs.ch Inventory & Supply Chain

Owner: **AGENT 7 — Chargeurs Inventory & Supply Chain**.

This directory documents the isolated hardware inventory and supplier domain. Runtime rental, payment, kiosk UX, Advertising and low-level hardware control remain owned by their respective domains.

## Supplier catalog foundation

Current branch: `agent/inventory/supplier-catalog`.

Implemented:

- Supplier Master;
- supplier source documents;
- supplier contact and technical-contact targets;
- generic Product families;
- Product Variants;
- Supplier Products;
- supplier quote tiers/configurations;
- explicit source provenance (`SUPPLIER_DECLARED` by default).

Bajie normalization rules are documented in `BAJIE_SUPPLIER_CATALOG.md`.

Real staging execution and invariant evidence is documented in `SUPPLIER_CATALOG_STAGING_VALIDATION.md`.

## Domain invariant

A supplier-catalog row does **not** mean Chargeurs.ch owns, has physically observed, has approved, has verified compatibility for, or sells that item.

Owned assets, serial numbers, physical locations, movement ledger, purchase receipts, maintenance, RMA, BOM and compatibility are separate Agent 7 workstreams layered on top of this catalog.
