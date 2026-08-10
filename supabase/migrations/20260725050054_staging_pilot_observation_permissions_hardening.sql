revoke all on table public.local_gateway_observations from public, anon, authenticated;
grant select, insert on table public.local_gateway_observations to service_role;
revoke execute on function public.self_enroll_staging_kiosk(text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.self_enroll_staging_kiosk(text, text, uuid, text) to service_role;
