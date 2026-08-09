-- FIELD_DEPLOYMENT_RC1: the cleanup cron legitimately terminalizes unpaid
-- `created` / `checkout_created` sessions as `expired`. The monotone state
-- guard introduced earlier omitted that state, causing the scheduled cleanup
-- to fail every five minutes with RENTAL_STATE_REGRESSION.
--
-- `expired` belongs to the same terminal family as payment_expired/cancelled.

create or replace function public.rental_session_state_rank(p_state text)
returns integer
language sql
immutable
set search_path = public
as $$
  select case lower(coalesce(p_state, ''))
    when 'created' then 10
    when 'checkout_created' then 10
    when 'payment_pending' then 10
    when 'payment_succeeded' then 20
    when 'paid' then 20
    when 'authorized' then 20
    when 'prepaid' then 20
    when 'slot_reserved' then 25
    when 'ejection_requested' then 30
    when 'ejecting' then 30
    when 'ejected' then 40
    when 'ejection_confirmed' then 40
    when 'battery_taken' then 40
    when 'active_rental' then 40
    when 'battery_returned' then 50
    when 'return_detected' then 50
    when 'closing_order' then 50
    when 'settling' then 50
    when 'closed' then 60
    when 'completed' then 60
    when 'refunded' then 60
    when 'expired' then 70
    when 'payment_failed' then 70
    when 'payment_expired' then 70
    when 'payment_cancelled' then 70
    when 'cancelled' then 70
    when 'eject_failed' then 80
    when 'chargenow_failed' then 80
    when 'settlement_failed' then 80
    when 'manual_review' then 80
    when 'needs_support' then 80
    when 'failed' then 80
    else 0
  end;
$$;

comment on function public.rental_session_state_rank(text) is
  'Monotone kiosk rental state rank. Expired unpaid sessions are terminal rank 70.';
