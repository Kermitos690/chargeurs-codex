alter table public.advertising_campaign_items
  add column if not exists qr_url text;

alter table public.advertising_campaign_items
  drop constraint if exists advertising_campaign_items_qr_url_https;

alter table public.advertising_campaign_items
  add constraint advertising_campaign_items_qr_url_https
  check (
    qr_url is null
    or (
      qr_url ~ '^https://'
      and qr_url !~ '[[:space:]]'
    )
  );

comment on column public.advertising_campaign_items.qr_url is
  'Optional per-media advertising QR destination. When null, kiosk falls back to advertising_campaigns.qr_url.';
