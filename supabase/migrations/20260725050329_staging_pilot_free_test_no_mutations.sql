insert into public.kiosk_settings(key, value)
values ('chargenow_mutations_enabled', '{"enabled": false}'::jsonb)
on conflict (key) do update set value = excluded.value;
