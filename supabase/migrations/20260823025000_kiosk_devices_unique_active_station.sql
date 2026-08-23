create unique index if not exists kiosk_devices_one_active_per_station
on public.kiosk_devices(station_id)
where active is true and token_revoked is false;
