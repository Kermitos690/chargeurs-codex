update public.station_hardware_quarantines q
set active = false,
    cleared_at = now(),
    cleared_by = null,
    updated_at = now(),
    details = coalesce(q.details, '{}'::jsonb) || jsonb_build_object(
      'cleared_reason','source_rental_completed_and_settled',
      'cleared_source','chatgpt_ops'
    )
where q.station_id = 'DTA21269'
  and q.active = true
  and q.reason_code = 'RC_RECONCILIATION_IN_PROGRESS'
  and exists (
    select 1 from public.rental_sessions r
    where r.id = q.source_rental_session_id
      and r.state = 'completed'
      and r.settlement_status = 'settled'
      and r.returned_at is not null
  );

update public.stations s
set status = 'online',
    online = true,
    rentable_count = (
      select count(*)::integer from public.batteries b
      where b.station_id = s.station_id
        and b.status = 'in_station'
        and coalesce(b.power_level,0) >= 20
    ),
    returnable_count = 0,
    total_count = 4,
    updated_at = now()
where s.station_id = 'DTA21269'
  and not exists (
    select 1 from public.station_hardware_quarantines q
    where q.station_id = s.station_id and q.active = true
  );
