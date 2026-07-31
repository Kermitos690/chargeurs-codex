-- Reconcile provider metadata already captured by a read-only ChargeNow sync.
-- This does not call or mutate ChargeNow and intentionally does not infer a
-- local partner/shop relation from the provider shop.
update public.stations
set provider_shop_id = nullif(raw_data->'shop'->>'id', ''),
    location_name = coalesce(
      nullif(raw_data->'shop'->>'address', ''),
      nullif(raw_data->'shop'->>'name', '')
    )
where station_id = 'DTA21269'
  and raw_data is not null;
