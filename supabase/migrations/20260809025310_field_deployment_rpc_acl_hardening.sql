-- FIELD_DEPLOYMENT_RC1: internal rental mutation RPCs are service-role only.
-- Supabase may retain explicit anon/authenticated EXECUTE grants from prior
-- function versions, so revoke those roles explicitly in addition to PUBLIC.

revoke all on function public.create_reserved_kiosk_rental_session(jsonb)
  from public, anon, authenticated;
revoke all on function public.transition_rental_session(uuid, bigint, text, text, jsonb)
  from public, anon, authenticated;

grant execute on function public.create_reserved_kiosk_rental_session(jsonb)
  to service_role;
grant execute on function public.transition_rental_session(uuid, bigint, text, text, jsonb)
  to service_role;
