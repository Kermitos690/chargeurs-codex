insert into public.kiosk_settings(key, value)
values
  ('simulation_mode', '{"enabled": false}'::jsonb),
  ('beta_rentals_enabled', '{"enabled": false}'::jsonb)
on conflict (key) do update set value = excluded.value;
