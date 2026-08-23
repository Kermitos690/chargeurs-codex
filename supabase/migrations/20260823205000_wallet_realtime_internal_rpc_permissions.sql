-- Wallet realtime helpers are backend-internal. Do not expose SECURITY DEFINER helpers to browser roles.

revoke all on function public.enqueue_customer_wallet_sync_event(uuid,text,text,uuid,jsonb,timestamptz) from public, anon, authenticated;
revoke all on function public.customer_wallet_pricing_state(jsonb,timestamptz,timestamptz) from public, anon, authenticated;
revoke all on function public.customer_wallet_presentation_state(uuid) from public, anon, authenticated;
revoke all on function public.queue_due_customer_wallet_price_transitions() from public, anon, authenticated;
revoke all on function public.customer_wallet_realtime_rental_events() from public, anon, authenticated;
revoke all on function public.customer_wallet_chargepoints_events() from public, anon, authenticated;
revoke all on function public.customer_wallet_membership_events() from public, anon, authenticated;

grant execute on function public.enqueue_customer_wallet_sync_event(uuid,text,text,uuid,jsonb,timestamptz) to service_role;
grant execute on function public.customer_wallet_pricing_state(jsonb,timestamptz,timestamptz) to service_role;
grant execute on function public.customer_wallet_presentation_state(uuid) to service_role;
grant execute on function public.queue_due_customer_wallet_price_transitions() to service_role;
