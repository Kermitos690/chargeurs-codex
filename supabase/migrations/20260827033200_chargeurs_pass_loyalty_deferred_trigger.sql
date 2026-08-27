-- Evaluate loyalty only after the rental settlement transaction has finished
-- updating rental_sessions and wallet allocations. This avoids observing a
-- rental_completed orchestrator event before final_amount_cents is projected.

drop trigger if exists "chargeurs-apply-loyalty-missions" on public.rental_orchestrator_events;

create constraint trigger "chargeurs-apply-loyalty-missions"
after insert on public.rental_orchestrator_events
deferrable initially deferred
for each row
execute function public.apply_loyalty_missions_on_rental_event();
