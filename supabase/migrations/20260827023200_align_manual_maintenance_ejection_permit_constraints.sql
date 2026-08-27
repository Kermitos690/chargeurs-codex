do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.maintenance_ejection_permits'::regclass
      and conname = 'maintenance_ejection_permits_station_id_fkey'
  ) then
    alter table public.maintenance_ejection_permits
      add constraint maintenance_ejection_permits_station_id_fkey
      foreign key (station_id) references public.stations(station_id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.maintenance_ejection_permits'::regclass
      and conname = 'maintenance_ejection_permits_terminal_check'
  ) then
    alter table public.maintenance_ejection_permits
      add constraint maintenance_ejection_permits_terminal_check
      check (not (consumed_at is not null and cancelled_at is not null));
  end if;
end
$$;
