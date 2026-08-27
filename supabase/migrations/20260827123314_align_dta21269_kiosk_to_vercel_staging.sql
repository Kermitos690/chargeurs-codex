-- One canonical STAGING web origin for the pilot kiosk.  The Android wrapper,
-- kiosk enrollment and the public station projection must agree on this value.
-- Do not alter pricing, payment, rental, hardware or station operational state.
do $$
declare
  v_station public.stations%rowtype;
begin
  select *
    into v_station
    from public.stations
   where station_id = 'DTA21269'
   for update;

  if not found then
    raise exception 'DTA21269 station is missing';
  end if;

  if v_station.environment is distinct from 'staging' or v_station.is_pilot is distinct from true then
    raise exception 'DTA21269 is not the expected STAGING pilot station';
  end if;

  update public.stations
     set kiosk_url = 'https://chargeurs-ch-staging.vercel.app/kiosk/DTA21269'
   where station_id = 'DTA21269'
     and kiosk_url is distinct from 'https://chargeurs-ch-staging.vercel.app/kiosk/DTA21269';
end
$$;
