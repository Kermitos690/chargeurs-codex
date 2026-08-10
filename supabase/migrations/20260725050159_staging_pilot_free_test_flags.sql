insert into public.kiosk_settings(key, value)
values
  ('local_hardware_ejection_enabled', '{"enabled": false}'::jsonb),
  ('stripe_live_enabled', '{"enabled": false}'::jsonb),
  ('kiosk_rentals_enabled', '{"enabled": false}'::jsonb)
on conflict (key) do update set value = excluded.value;
