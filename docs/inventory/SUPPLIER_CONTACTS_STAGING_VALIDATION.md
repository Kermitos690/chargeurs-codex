# AGENT 7 — Bajie Supplier Contacts / Capabilities — Staging Validation

## Environment

- Supabase project: `chargeurs-ch-staging`
- Project ref: `xqepbqnaenoeyfjkjnzl`
- Branch: `agent/inventory/supplier-contacts`
- Production: **not touched**

## Source distinction

The current contact channel was checked against the official BAJIE CHARGING website on 2026-08-11.

Two provenance levels are deliberately separated:

- current email / WhatsApp publication: `VERIFIED` as an official currently published contact channel;
- OEM, white-label, 24/7 support, end-to-end solution and venue-fit statements: `SUPPLIER_DECLARED`, because they remain supplier marketing claims even when published on the official website.

## Verified current supplier contact

Role: `general_sales_support`

- email: `info@chargenow.top`;
- phone / WhatsApp: `+86 134 8460 4813`;
- verification state: `VERIFIED`;
- source type: `official_supplier_website`.

This contact is **not** promoted to a named technical engineer, spare-parts manager or RMA owner. Those role-specific contacts remain unresolved.

## Supplier-declared capabilities recorded

- OEM branding;
- white-label branding;
- end-to-end hardware + software solution;
- 24/7 support.

Each remains `SUPPLIER_DECLARED`.

## Supplier-declared target venue types recorded

- shopping mall;
- airport;
- hotel;
- restaurant;
- stadium;
- gym;
- train station;
- theme park;
- university.

These are supplier market-fit claims, not Chargeurs.ch deployment results or commercial strategy.

## Test result

`supabase/tests/inventory-supplier-contacts.sql` passed on staging.

The test verifies:

- exactly one current verified general contact with the official email and WhatsApp/phone;
- exactly four capability claims;
- capability claims remain `SUPPLIER_DECLARED`;
- exactly nine target venue claims;
- venue claims remain `SUPPLIER_DECLARED`;
- official website source record is `VERIFIED`.

## Next supplier outreach

Use the verified general channel to request named owners and evidence for:

1. technical hardware;
2. spare parts;
3. after-sales / RMA;
4. firmware / protocol;
5. logistics / export;
6. certification / compliance;
7. business manager / account owner.

The contact itself is now usable; the specialist roles remain `UNKNOWN` until Bajie responds.
