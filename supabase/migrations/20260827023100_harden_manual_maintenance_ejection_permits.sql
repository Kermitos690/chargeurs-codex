alter table public.maintenance_ejection_permits
  add column if not exists provider_result jsonb;

create or replace function public.validate_maintenance_ejection_permit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_battery text;
  station_online boolean;
begin
  if new.slot_num < 1 then
    raise exception 'MAINTENANCE_SLOT_ZERO_FORBIDDEN';
  end if;

  select s.online into station_online
  from public.stations s
  where s.station_id = new.station_id;

  if coalesce(station_online, false) is not true then
    raise exception 'MAINTENANCE_STATION_NOT_ONLINE';
  end if;

  select ss.battery_id into current_battery
  from public.station_slots ss
  where ss.station_id = new.station_id
    and ss.slot_num = new.slot_num;

  if current_battery is null then
    raise exception 'MAINTENANCE_SLOT_EMPTY';
  end if;

  if current_battery is distinct from new.expected_battery_id then
    raise exception 'MAINTENANCE_BATTERY_CHANGED';
  end if;

  if exists (
    select 1
    from public.rental_sessions r
    where r.battery_id = new.expected_battery_id
      and r.state not in (
        'completed', 'expired', 'payment_cancelled', 'payment_expired',
        'payment_failed', 'refunded', 'cancelled', 'failed'
      )
  ) then
    raise exception 'MAINTENANCE_ACTIVE_RENTAL_EXISTS';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_maintenance_ejection_permit() from public, anon, authenticated;

drop trigger if exists trg_validate_maintenance_ejection_permit on public.maintenance_ejection_permits;
create trigger trg_validate_maintenance_ejection_permit
before insert on public.maintenance_ejection_permits
for each row execute function public.validate_maintenance_ejection_permit();
