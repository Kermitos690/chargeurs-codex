-- Keep internal SECURITY DEFINER trigger functions out of the exposed RPC surface.
-- Trigger execution itself does not depend on client EXECUTE grants.
-- Public kiosk RPCs such as kiosk_quote and kiosk_session_status are intentionally untouched.

REVOKE EXECUTE ON FUNCTION public.apply_customer_rewards_on_rental_completion() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_loyalty_missions_on_rental_event() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.block_new_rental_on_hardware_quarantine() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.broadcast_kiosk_battery_in_hint() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.customer_wallet_native_rental_events() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_active_membership_on_member_rental() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_rental_transactional_emails() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.preserve_hardware_quarantine_station_projection() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_chargepoints_ledger_mutation() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_membership_usage_mutation() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_promotion_redemption_mutation() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.project_orchestrator_event_to_rental_session() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.queue_membership_lifecycle_email() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reconcile_chargenow_borrow_out_event() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_pass_wallet_hold_on_safe_pre_release_terminal_state() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_battery_location_from_slot() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_refunded_payment_to_rental_session() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trace_hardware_release_command_from_api_log() FROM PUBLIC, anon, authenticated;
