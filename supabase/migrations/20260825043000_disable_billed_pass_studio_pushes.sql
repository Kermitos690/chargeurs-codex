-- Pass Studio bills every provider push. Keep automatic provider pushes disabled unless
-- a deliberate, documented billing approval enables this setting again.
insert into public.app_settings (key, value, public, description)
values (
  'customer_wallet.pass_studio_push',
  '{"enabled": false, "reason": "billed_per_push_requires_explicit_approval"}'::jsonb,
  false,
  'Controls automatic billed Pass Studio field updates and notifications. Free PWA web push is independent.'
)
on conflict (key) do update
set value = excluded.value,
    public = excluded.public,
    description = excluded.description,
    updated_at = now();

