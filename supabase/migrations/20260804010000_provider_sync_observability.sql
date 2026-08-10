-- Keep operational safety (`online`) separate from diagnostics. A failed or
-- contradictory ChargeNow poll must not overwrite the time of the last valid
-- cabinet snapshot or be presented to operators as a confirmed hardware outage.
alter table public.stations
  add column if not exists provider_last_success_at timestamptz,
  add column if not exists provider_last_error_at timestamptz,
  add column if not exists provider_last_error text;

comment on column public.stations.provider_last_success_at is
  'Timestamp of the last ChargeNow response containing a recognized cabinet state.';
comment on column public.stations.provider_last_error_at is
  'Timestamp of the most recent unsuccessful or ambiguous ChargeNow poll.';
comment on column public.stations.provider_last_error is
  'Sanitized provider diagnostic code, never a credential or raw response.';

-- Backfill the last verified supplier observation from the audit trail when it
-- exists. Failed HTTP 200 business responses use a non-zero provider `code`.
-- For an ambiguous current state, restore `last_sync_at` to the last confirmed
-- observation instead of leaving it on the failed poll.
with latest_verified_observation as (
  select
    s.id,
    max(l.created_at) as observed_at
  from public.stations s
  join public.api_logs l
    on l.service = 'chargenow'
   and l.request ->> 'deviceId' = coalesce(s.cabinet_id, s.station_id)
   and l.status_code between 200 and 299
   and coalesce(l.response ->> 'code', '0') = '0'
  group by s.id
)
update public.stations s
set
  provider_last_success_at = coalesce(s.provider_last_success_at, latest.observed_at),
  last_sync_at = case
    when s.status = 'unknown' then latest.observed_at
    else s.last_sync_at
  end
from latest_verified_observation latest
where s.id = latest.id
  and s.provider_last_success_at is null;
