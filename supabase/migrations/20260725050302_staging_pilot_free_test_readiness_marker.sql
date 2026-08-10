insert into public.audit_logs(action, target, data)
values ('free_test.readiness_prepared', 'DTA21269', jsonb_build_object('payments_enabled', false, 'hardware_control_enabled', false, 'shadow_backend_ready', true, 'prepared_at', now()));
