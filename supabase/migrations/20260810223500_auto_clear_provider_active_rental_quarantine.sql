create or replace function public.clear_provider_active_rental_quarantine_on_return()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.returned_at is not null and old.returned_at is null then
    update public.station_hardware_quarantines q
    set active = false,
        cleared_at = now(),
        updated_at = now(),
        details = coalesce(q.details, '{}'::jsonb) || jsonb_build_object(
          'cleared_reason', 'source_rental_return_detected',
          'returned_at', new.returned_at,
          'return_station_id', new.return_station_id,
          'returned_slot_num', new.returned_slot_num
        )
    where q.station_id = new.station_id
      and q.active = true
      and q.reason_code = 'PROVIDER_ACTIVE_RENTAL'
      and q.source_rental_session_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_clear_provider_active_rental_quarantine_on_return on public.rental_sessions;
create trigger trg_clear_provider_active_rental_quarantine_on_return
after update of returned_at on public.rental_sessions
for each row
execute function public.clear_provider_active_rental_quarantine_on_return();