create or replace function public.project_orchestrator_event_to_rental_session()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_return_station text;
  v_return_slot integer;
  v_final_cents bigint;
begin
  if new.event_type = 'battery_released' then
    update public.rental_sessions
    set state = case when public.rental_session_state_rank(state) < public.rental_session_state_rank('ejected') then 'ejected' else state end,
        ejected_at = coalesce(ejected_at, new.occurred_at),
        chargenow_status = 'ejected',
        failure_code = null,
        failure_message = null,
        updated_at = now()
    where id = new.rental_id;
  elsif new.event_type = 'rental_activated' then
    update public.rental_sessions
    set started_at = coalesce(started_at, new.occurred_at),
        updated_at = now()
    where id = new.rental_id;
  elsif new.event_type = 'return_detected' then
    v_return_station := nullif(coalesce(new.metadata ->> 'returnStationId', new.metadata ->> 'stationId'), '');
    if coalesce(new.metadata ->> 'returnedSlotNum', '') ~ '^[0-9]+$' then
      v_return_slot := (new.metadata ->> 'returnedSlotNum')::integer;
    elsif coalesce(new.metadata ->> 'slotNum', '') ~ '^[0-9]+$' then
      v_return_slot := (new.metadata ->> 'slotNum')::integer;
    end if;
    update public.rental_sessions
    set state = case when public.rental_session_state_rank(state) < public.rental_session_state_rank('battery_returned') then 'battery_returned' else state end,
        returned_at = coalesce(returned_at, new.occurred_at),
        return_station_id = coalesce(return_station_id, v_return_station),
        returned_slot_num = coalesce(returned_slot_num, v_return_slot),
        updated_at = now()
    where id = new.rental_id;
  elsif new.event_type = 'pricing_finalized' then
    if coalesce(new.metadata ->> 'finalAmountCents', '') ~ '^[0-9]+$' then
      v_final_cents := (new.metadata ->> 'finalAmountCents')::bigint;
    elsif coalesce(new.metadata #>> '{pricingSnapshot,final_cents}', '') ~ '^[0-9]+$' then
      v_final_cents := (new.metadata #>> '{pricingSnapshot,final_cents}')::bigint;
    end if;
    if v_final_cents is not null then
      update public.rental_sessions
      set final_amount_cents = coalesce(final_amount_cents, v_final_cents),
          updated_at = now()
      where id = new.rental_id;
    end if;
  elsif new.event_type = 'rental_completed' then
    update public.rental_sessions
    set state = case when public.rental_session_state_rank(state) < public.rental_session_state_rank('completed') then 'completed' else state end,
        closed_at = coalesce(closed_at, new.occurred_at),
        updated_at = now()
    where id = new.rental_id;
  end if;
  return new;
end;
$function$;

with latest_pricing as (
  select distinct on (rental_id)
    rental_id,
    (metadata ->> 'finalAmountCents')::bigint as final_cents
  from public.rental_orchestrator_events
  where event_type = 'pricing_finalized'
    and coalesce(metadata ->> 'finalAmountCents', '') ~ '^[0-9]+$'
  order by rental_id, occurred_at desc
)
update public.rental_sessions r
set final_amount_cents = lp.final_cents,
    updated_at = now()
from latest_pricing lp
where r.id = lp.rental_id
  and r.final_amount_cents is null;
