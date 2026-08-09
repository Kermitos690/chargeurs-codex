-- Keep the customer/kiosk rental projection aligned with the canonical
-- orchestrator event stream. The canonical append function remains the source
-- of truth; this trigger only mirrors proven milestones into rental_sessions.

create or replace function public.project_orchestrator_event_to_rental_session()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_return_station text;
  v_return_slot integer;
begin
  if new.event_type = 'battery_released' then
    update public.rental_sessions
    set state = case
          when public.rental_session_state_rank(state) < public.rental_session_state_rank('ejected') then 'ejected'
          else state
        end,
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
    v_return_station := nullif(coalesce(
      new.metadata ->> 'returnStationId',
      new.metadata ->> 'stationId'
    ), '');
    if coalesce(new.metadata ->> 'returnedSlotNum', '') ~ '^[0-9]+$' then
      v_return_slot := (new.metadata ->> 'returnedSlotNum')::integer;
    elsif coalesce(new.metadata ->> 'slotNum', '') ~ '^[0-9]+$' then
      v_return_slot := (new.metadata ->> 'slotNum')::integer;
    end if;

    update public.rental_sessions
    set state = case
          when public.rental_session_state_rank(state) < public.rental_session_state_rank('battery_returned') then 'battery_returned'
          else state
        end,
        returned_at = coalesce(returned_at, new.occurred_at),
        return_station_id = coalesce(return_station_id, v_return_station),
        returned_slot_num = coalesce(returned_slot_num, v_return_slot),
        updated_at = now()
    where id = new.rental_id;

  elsif new.event_type = 'rental_completed' then
    update public.rental_sessions
    set state = case
          when public.rental_session_state_rank(state) < public.rental_session_state_rank('completed') then 'completed'
          else state
        end,
        closed_at = coalesce(closed_at, new.occurred_at),
        updated_at = now()
    where id = new.rental_id;
  end if;

  return new;
end;
$$;

revoke all on function public.project_orchestrator_event_to_rental_session() from public;

drop trigger if exists trg_project_orchestrator_event_to_rental_session
  on public.rental_orchestrator_events;
create trigger trg_project_orchestrator_event_to_rental_session
after insert on public.rental_orchestrator_events
for each row
execute function public.project_orchestrator_event_to_rental_session();

-- Backfill only milestones already proven by the immutable event stream.
with latest_release as (
  select distinct on (rental_id) rental_id, occurred_at
  from public.rental_orchestrator_events
  where event_type = 'battery_released'
  order by rental_id, resulting_version desc
)
update public.rental_sessions rs
set ejected_at = coalesce(rs.ejected_at, e.occurred_at),
    state = case
      when public.rental_session_state_rank(rs.state) < public.rental_session_state_rank('ejected') then 'ejected'
      else rs.state
    end,
    chargenow_status = case when rs.chargenow_status = 'release_provider_confirmation_pending' then 'ejected' else rs.chargenow_status end,
    failure_code = case when rs.failure_code = 'EJECTION_PROVIDER_CONFIRMATION_PENDING' then null else rs.failure_code end,
    failure_message = case when rs.failure_code = 'EJECTION_PROVIDER_CONFIRMATION_PENDING' then null else rs.failure_message end
from latest_release e
where e.rental_id = rs.id;

with latest_activation as (
  select distinct on (rental_id) rental_id, occurred_at
  from public.rental_orchestrator_events
  where event_type = 'rental_activated'
  order by rental_id, resulting_version desc
)
update public.rental_sessions rs
set started_at = coalesce(rs.started_at, e.occurred_at)
from latest_activation e
where e.rental_id = rs.id;

with latest_return as (
  select distinct on (rental_id) rental_id, occurred_at, metadata
  from public.rental_orchestrator_events
  where event_type = 'return_detected'
  order by rental_id, resulting_version desc
)
update public.rental_sessions rs
set state = case
      when public.rental_session_state_rank(rs.state) < public.rental_session_state_rank('battery_returned') then 'battery_returned'
      else rs.state
    end,
    returned_at = coalesce(rs.returned_at, e.occurred_at),
    return_station_id = coalesce(rs.return_station_id, nullif(coalesce(e.metadata->>'returnStationId', e.metadata->>'stationId'), '')),
    returned_slot_num = coalesce(rs.returned_slot_num,
      case
        when coalesce(e.metadata->>'returnedSlotNum','') ~ '^[0-9]+$' then (e.metadata->>'returnedSlotNum')::integer
        when coalesce(e.metadata->>'slotNum','') ~ '^[0-9]+$' then (e.metadata->>'slotNum')::integer
        else null
      end)
from latest_return e
where e.rental_id = rs.id;
