alter table public.advertising_campaigns
  add column if not exists qr_url text;

alter table public.advertising_campaigns
  drop constraint if exists advertising_campaigns_qr_url_https;

alter table public.advertising_campaigns
  add constraint advertising_campaigns_qr_url_https
  check (
    qr_url is null
    or (
      char_length(qr_url) between 8 and 1000
      and qr_url ~ '^https://'
    )
  );
