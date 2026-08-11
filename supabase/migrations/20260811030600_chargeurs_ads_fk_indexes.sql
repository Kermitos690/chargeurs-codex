create index if not exists advertising_campaigns_created_by_idx on public.advertising_campaigns(created_by) where created_by is not null;
create index if not exists advertising_assets_created_by_idx on public.advertising_assets(created_by) where created_by is not null;
create index if not exists advertising_campaign_items_asset_idx on public.advertising_campaign_items(asset_id);
create index if not exists advertising_impressions_asset_idx on public.advertising_impressions(asset_id, started_at desc);
create index if not exists advertising_impressions_kiosk_device_idx on public.advertising_impressions(kiosk_device_id, started_at desc) where kiosk_device_id is not null;
