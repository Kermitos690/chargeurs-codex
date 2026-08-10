insert into public.audit_logs(action, target, data)
values (
  'staging.free_test_guardrails_applied',
  'DTA21269',
  jsonb_build_object(
    'simulation_mode', false,
    'beta_rentals_enabled', false,
    'kiosk_rentals_enabled', false,
    'local_hardware_ejection_enabled', false,
    'stripe_live_enabled', false,
    'applied_at', now()
  )
);
