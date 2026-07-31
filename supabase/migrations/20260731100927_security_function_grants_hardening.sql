-- Lock down SECURITY DEFINER helpers that are only used by trusted server paths.
--
-- PostgreSQL grants EXECUTE to PUBLIC when a function is created.  Revoking
-- PUBLIC alone is not enough when Supabase's anon/authenticated roles have
-- explicit grants (which can survive a later function replacement), so all
-- client-facing roles are removed explicitly and service_role is granted only
-- where the Edge Functions require it.

revoke execute on function public.api_quota_hit(uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.api_quota_hit(uuid, integer, integer)
  to service_role;

revoke execute on function public.enforce_kiosk_beta_release_gate()
  from public, anon, authenticated;

revoke execute on function public.price_profile_record_version()
  from public, anon, authenticated;

comment on function public.api_quota_hit(uuid, integer, integer) is
  'Internal service-role quota counter; not callable by browser roles.';

comment on function public.enforce_kiosk_beta_release_gate() is
  'Trigger-only fail-closed beta gate; not callable by browser roles.';

comment on function public.price_profile_record_version() is
  'Trigger-only pricing history writer; not callable by browser roles.';
