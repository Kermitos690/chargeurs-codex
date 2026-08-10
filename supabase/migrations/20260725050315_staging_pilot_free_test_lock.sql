insert into public.kiosk_settings(key, value)
values ('free_test_mode', '{"enabled": true, "stationId": "DTA21269", "priceChf": 0, "hardwareControl": false}'::jsonb)
on conflict (key) do update set value = excluded.value;
