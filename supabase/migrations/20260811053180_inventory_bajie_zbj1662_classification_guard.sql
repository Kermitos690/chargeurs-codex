-- AGENT 7 - conservative classification guard for Bajie ZBJ-166-2.
--
-- The model is printed inside the supplier's "Shared Charging Station With Waterproof"
-- section, but the ZBJ-166-2 row itself does not declare Outdoor waterproof or IP54.
-- Keep the original supplier section in inventory_supplier_products.catalog_section,
-- while classifying the normalized Chargeurs.ch generic product family as a regular
-- floor-standing ADS station until Bajie explicitly confirms waterproof capability.

update public.inventory_product_variants v
set product_id = p.id,
    updated_at = now()
from public.inventory_products p
where v.internal_code = 'BAJIE-ZBJ-166-2'
  and p.code = 'FLOOR_STANDING_SHARED_CHARGING_STATION_ADS';

comment on table public.inventory_product_variants is
  'Normalized Chargeurs.ch candidate variants. Generic family classification may be more conservative than a supplier catalog section; provenance remains on inventory_supplier_products.';
