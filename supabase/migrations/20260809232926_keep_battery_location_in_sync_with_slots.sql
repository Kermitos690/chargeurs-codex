-- Keep normalized battery location aligned with the authoritative slot row.
-- This is a database projection only; it does not call ChargeNow.

create or replace function public.sync_battery_location_from_slot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.battery_id is not null and old.battery_id is distinct from new.battery_id then
    update public.batteries
       set station_id = null,
           slot_num = null,
           status = 'out_of_station',
           updated_at = now()
     where battery_id = old.battery_id
       and station_id = old.station_id
       and slot_num = old.slot_num;
  end if;

  if new.battery_id is not null then
    update public.batteries
       set station_id = new.station_id,
           slot_num = new.slot_num,
           status = 'in_station',
           updated_at = now()
     where battery_id = new.battery_id;
  end if;

  return new;
end;
$$;

revoke all on function public.sync_battery_location_from_slot() from public;

drop trigger if exists trg_sync_battery_location_from_slot on public.slots;
create trigger trg_sync_battery_location_from_slot
after insert or update of battery_id, station_id, slot_num on public.slots
for each row
execute function public.sync_battery_location_from_slot();
