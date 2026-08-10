-- An active hardware quarantine is a commercial/operator state that must not
-- be visually cleared by a successful provider synchronization. Provider
-- reachability, signal, raw telemetry and last-sync timestamps may still move,
-- but the public station remains non-rentable until the quarantine is cleared.

create or replace function public.preserve_hardware_quarantine_station_projection()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.station_hardware_quarantines q
    where q.station_id = new.station_id
      and q.active = true
  ) then
    new.status := 'maintenance';
    new.rentable_count := 0;
  end if;
  return new;
end;
$$;

revoke all on function public.preserve_hardware_quarantine_station_projection() from public;

drop trigger if exists trg_preserve_hardware_quarantine_station_projection on public.stations;
create trigger trg_preserve_hardware_quarantine_station_projection
before insert or update on public.stations
for each row
execute function public.preserve_hardware_quarantine_station_projection();
