create or replace function public.enforce_single_active_kiosk_device()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.active is true
     and coalesce(new.token_revoked, false) is false
     and new.station_id is not null then
    update public.kiosk_devices
       set active = false,
           token_revoked = true,
           revoked_at = coalesce(revoked_at, now()),
           updated_at = now()
     where station_id = new.station_id
       and id <> new.id
       and active is true
       and coalesce(token_revoked, false) is false;
  end if;
  return new;
end;
$$;

drop trigger if exists kiosk_devices_single_active_station on public.kiosk_devices;
create trigger kiosk_devices_single_active_station
before insert or update of station_id, active, token_revoked
on public.kiosk_devices
for each row
execute function public.enforce_single_active_kiosk_device();
