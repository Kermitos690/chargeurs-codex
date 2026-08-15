# Bajie supplier product imagery

`catalog-sprite.webp` contains 36 product reference images extracted from the supplier quotation provided to Chargeurs.ch (`Bajie Quotation.pdf`).

Status: **SUPPLIER_DECLARED**.

These images are used to identify and compare catalogue SKUs in the internal super-admin Inventory catalogue. They do **not** prove the colour, accessories, POS configuration, firmware, certifications or exact configuration ultimately delivered by the supplier.

The catalogue UI maps a supplier SKU to its cell in this sprite. Variants may intentionally reuse the base model image where the quotation presents the same visual family. If a product has no source image, the UI must show an explicit “Image fournisseur non disponible” state rather than inventing a visual.

Preview redeploy marker: 2026-08-15T18:51+02:00. This line is operational only and exists to re-trigger the staging preview after a Vercel build-rate-limit interruption.
