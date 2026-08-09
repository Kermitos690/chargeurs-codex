insert into public.audit_logs(action, target, data)
values ('local_gateway.shadow_mode_enabled', 'DTA21269', '{"mode":"shadow","localSerialRead":false,"localHardwareControl":false,"localEjection":false,"localReturnDetection":false}'::jsonb);
