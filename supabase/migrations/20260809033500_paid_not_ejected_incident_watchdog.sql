-- FIELD_DEPLOYMENT_RC1: surface paid rentals that have not been physically
-- reconciled instead of leaving them as invisible `ejecting` rows.
-- This is observability-only: it never changes a rental, payment or hardware
-- command and it never retries an ejection.

create unique index if not exists system_incidents_active_rental_type_key
  on public.system_incidents(type, rental_session_id)
  where resolved = false and rental_session_id is not null;

create or replace function public.refresh_field_incidents()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
  v_resolved integer := 0;
begin
  -- Resolve the alert only when the rental no longer matches the condition.
  -- A financial refund is considered a resolution of PAID_NOT_EJECTED; any
  -- separate provider/hardware ambiguity can remain represented by another
  -- incident type without keeping the customer-payment alert open forever.
  update public.system_incidents i
     set resolved = true,
         resolved_at = coalesce(i.resolved_at, now()),
         resolution = coalesce(i.resolution, 'Rental no longer in paid-not-ejected condition'),
         updated_at = now()
   where i.type = 'PAID_NOT_EJECTED'
     and i.resolved = false
     and i.rental_session_id is not null
     and not exists (
       select 1
       from public.rental_sessions r
       where r.id = i.rental_session_id
         and r.paid_at is not null
         and r.ejected_at is null
         and r.state in ('ejecting', 'ejection_requested', 'needs_support', 'manual_review')
         and r.paid_at <= now() - interval '5 minutes'
     );
  get diagnostics v_resolved = row_count;

  insert into public.system_incidents(
    type, severity, message, data, resolved, rental_session_id, station_id, created_at, updated_at
  )
  select
    'PAID_NOT_EJECTED',
    'critical',
    'Paiement confirmé mais sortie batterie non réconciliée',
    jsonb_build_object(
      'state', r.state,
      'state_version', r.state_version,
      'slot_num', r.selected_slot_num,
      'battery_id', r.battery_id,
      'paid_at', r.paid_at,
      'chargenow_status', r.chargenow_status,
      'failure_code', r.failure_code,
      'age_seconds', greatest(0, floor(extract(epoch from (now() - r.paid_at))))::integer
    ),
    false,
    r.id,
    r.station_id,
    now(),
    now()
  from public.rental_sessions r
  where r.paid_at is not null
    and r.ejected_at is null
    and r.state in ('ejecting', 'ejection_requested', 'needs_support', 'manual_review')
    and r.paid_at <= now() - interval '5 minutes'
    and not exists (
      select 1 from public.system_incidents i
      where i.type = 'PAID_NOT_EJECTED'
        and i.rental_session_id = r.id
        and i.resolved = false
    )
  on conflict do nothing;
  get diagnostics v_inserted = row_count;

  return jsonb_build_object('inserted', v_inserted, 'resolved', v_resolved);
end;
$$;

revoke all on function public.refresh_field_incidents() from public, anon, authenticated;
grant execute on function public.refresh_field_incidents() to service_role;

-- pg_cron is already in use for stale-session cleanup. Keep this watchdog at
-- the same low frequency; it is a local database query and performs no network
-- or provider action.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'field-incident-watchdog') then
    perform cron.unschedule('field-incident-watchdog');
  end if;
  perform cron.schedule(
    'field-incident-watchdog',
    '*/5 * * * *',
    'SELECT public.refresh_field_incidents();'
  );
end;
$$;

select public.refresh_field_incidents();
