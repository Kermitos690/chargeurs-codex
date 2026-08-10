update public.stations
set environment = 'staging',
    is_pilot = true
where station_id = 'DTA21269';

update public.kiosk_settings
set value = jsonb_build_object('enabled', false)
where key in ('simulation_mode', 'beta_rentals_enabled');
