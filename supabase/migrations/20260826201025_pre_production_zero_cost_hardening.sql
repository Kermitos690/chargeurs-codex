-- Pre-production P0/P1 hardening only.
-- This migration neither changes pricing nor initiates a rental, Stripe action,
-- supplier call, physical command, or customer notification.

-- P0: a historical DTA21269 reconciliation helper must never be exposed through
-- PostgREST.  Resolve the signature dynamically because production drift left
-- historical overloads outside the checked-in migration chain.
do $hardening$
declare
  target record;
begin
  for target in
    select p.oid, p.oid::regprocedure::text as identity
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'reconcile_dta21269_pre_release_missing_authorization_projection'
  loop
    execute format('revoke all privileges on function %s from public', target.identity);
    execute format('revoke all privileges on function %s from anon', target.identity);
    execute format('revoke all privileges on function %s from authenticated', target.identity);
    execute format('grant execute on function %s to service_role', target.identity);

    if has_function_privilege('anon', target.oid, 'execute') then
      raise exception 'P0 ACL assertion failed: anon can execute %', target.identity;
    end if;
  end loop;
end
$hardening$;

-- P1: Pass Studio confirmed that every provider push is billable, including a
-- per-holder field refresh when it reaches the device. Keep both automatic
-- provider paths closed; manual pass issuance remains on its existing path.
insert into public.app_settings (key, value, public, description)
values
  ('customer_wallet.pass_studio_push', '{"enabled": false, "reason": "pre_production_zero_cost_hardening"}'::jsonb, false, 'Billed or bulk PassStudio push is disabled.'),
  ('customer_wallet.pass_studio_instance_sync', '{"enabled": false, "reason": "provider_push_is_billable"}'::jsonb, false, 'Automatic PassStudio instance synchronization is disabled because a delivered provider push consumes a credit.')
on conflict (key) do update
set value = excluded.value,
    public = false,
    description = excluded.description,
    updated_at = now();

-- P1: retain non-financial raw advertising telemetry for 14 days, while keeping
-- daily aggregates for longer-term reporting.  The aggregate is deliberately
-- detached from mutable campaign foreign keys so an archived campaign cannot
-- erase historical totals.  Financial, rental and incident tables are untouched.
create table if not exists public.advertising_impression_daily (
  day date not null,
  campaign_id uuid not null,
  asset_id uuid not null,
  station_id text not null,
  display_mode text not null check (display_mode in ('split', 'screensaver')),
  raw_rows bigint not null default 0 check (raw_rows >= 0),
  completed_rows bigint not null default 0 check (completed_rows >= 0),
  total_duration_ms bigint not null default 0 check (total_duration_ms >= 0),
  aggregated_at timestamptz not null default now(),
  primary key (day, campaign_id, asset_id, station_id, display_mode)
);

alter table public.advertising_impression_daily enable row level security;
revoke all on public.advertising_impression_daily from public, anon, authenticated;
grant all on public.advertising_impression_daily to service_role;

create or replace function public.retire_advertising_impressions(
  p_retention_days integer default 14
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_cutoff timestamptz;
  v_deleted bigint := 0;
begin
  if p_retention_days < 14 or p_retention_days > 90 then
    raise exception using errcode = '22023', message = 'ADVERTISING_RETENTION_DAYS_OUT_OF_RANGE';
  end if;

  -- A second invocation must not double-add aggregates while the first is
  -- still holding its transaction.  pg_cron and manual service-role calls are
  -- therefore idempotent as one atomic archive/delete operation.
  if not pg_try_advisory_xact_lock(hashtextextended('chargeurs:advertising-impression-retention', 0)) then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'RETENTION_ALREADY_RUNNING');
  end if;

  v_cutoff := now() - make_interval(days => p_retention_days);
  with rows_to_archive as materialized (
    select id, date_trunc('day', started_at)::date as day, campaign_id, asset_id,
      station_id, display_mode, completed, coalesce(duration_ms, 0) as duration_ms
    from public.advertising_impressions
    where created_at < v_cutoff
  ), archived as (
    insert into public.advertising_impression_daily (
      day, campaign_id, asset_id, station_id, display_mode,
      raw_rows, completed_rows, total_duration_ms, aggregated_at
    )
    select day, campaign_id, asset_id, station_id, display_mode,
      count(*)::bigint,
      count(*) filter (where completed)::bigint,
      coalesce(sum(duration_ms), 0)::bigint,
      now()
    from rows_to_archive
    group by day, campaign_id, asset_id, station_id, display_mode
    on conflict (day, campaign_id, asset_id, station_id, display_mode) do update
      set raw_rows = public.advertising_impression_daily.raw_rows + excluded.raw_rows,
          completed_rows = public.advertising_impression_daily.completed_rows + excluded.completed_rows,
          total_duration_ms = public.advertising_impression_daily.total_duration_ms + excluded.total_duration_ms,
          aggregated_at = excluded.aggregated_at
    returning 1
  ), deleted as (
    delete from public.advertising_impressions
    where id in (select id from rows_to_archive)
    returning 1
  )
  select count(*) into v_deleted from deleted;

  return jsonb_build_object('ok', true, 'cutoff', v_cutoff, 'deleted_raw_rows', v_deleted);
end;
$function$;

revoke all on function public.retire_advertising_impressions(integer) from public, anon, authenticated;
grant execute on function public.retire_advertising_impressions(integer) to service_role;

-- A database-local job creates zero Edge Function invocations.  It replaces no
-- financial reconciliation cadence and runs outside kiosk opening hours.
do $cron$
begin
  if exists (select 1 from cron.job where jobname = 'chargeurs-advertising-impression-retention') then
    perform cron.unschedule('chargeurs-advertising-impression-retention');
  end if;
  perform cron.schedule(
    'chargeurs-advertising-impression-retention',
    '17 03 * * *',
    'select public.retire_advertising_impressions(14);'
  );

  -- E-mail is a non-transaction-critical queue. Five minutes preserves useful
  -- delivery while reducing fixed Edge invocations from 43,200 to 8,640/month.
  if exists (select 1 from cron.job where jobname = 'chargeurs-transactional-email-outbox') then
    perform cron.alter_job(
      (select jobid from cron.job where jobname = 'chargeurs-transactional-email-outbox' limit 1),
      '*/5 * * * *',
      null,
      null,
      null,
      true
    );
  end if;
end
$cron$;
