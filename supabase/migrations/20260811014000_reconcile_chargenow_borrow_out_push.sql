create or replace function public.reconcile_chargenow_borrow_out_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_station_id text;
  v_trade_no text;
  v_battery_id text;
  v_slot_num integer;
  v_event_id text;
  v_match_count integer;
  v_session public.rental_sessions%rowtype;
  v_version bigint;
  v_occurred_at timestamptz;
begin
  v_station_id := coalesce(
    nullif(new.station_id, ''),
    nullif(new.payload ->> 'cabinetId', ''),
    nullif(new.payload #>> '{eventData,cabinetId}', '')
  );
  v_trade_no := coalesce(
    nullif(new.payload ->> 'orderId', ''),
    nullif(new.payload #>> '{eventData,orderId}', ''),
    nullif(new.payload ->> 'rentOrderId', ''),
    nullif(new.payload #>> '{eventData,rentOrderId}', '')
  );
  v_battery_id := coalesce(
    nullif(new.payload ->> 'outBatteryId', ''),
    nullif(new.payload #>> '{eventData,outBatteryId}', ''),
    nullif(new.payload ->> 'batteryId', ''),
    nullif(new.payload #>> '{eventData,batteryId}', '')
  );
  if coalesce(new.payload ->> 'outSlot', new.payload #>> '{eventData,outSlot}', new.payload ->> 'slotNum') ~ '^[0-9]+$' then
    v_slot_num := coalesce(new.payload ->> 'outSlot', new.payload #>> '{eventData,outSlot}', new.payload ->> 'slotNum')::integer;
  end if;
  v_event_id := coalesce(nullif(new.external_event_id, ''), nullif(new.payload ->> 'eventId', ''));
  v_occurred_at := coalesce(new.received_at, now());

  if v_station_id is null or v_trade_no is null or v_battery_id is null or v_slot_num is null or v_slot_num < 1 or v_event_id is null then
    return new;
  end if;

  select count(*) into v_match_count
  from public.rental_sessions r
  where r.station_id = v_station_id
    and r.apifox_trade_no = v_trade_no
    and r.battery_id = v_battery_id
    and r.selected_slot_num = v_slot_num
    and r.state = 'ejecting'
    and r.chargenow_status = 'release_provider_confirmation_pending';

  if v_match_count <> 1 then
    return new;
  end if;

  select * into v_session
  from public.rental_sessions r
  where r.station_id = v_station_id
    and r.apifox_trade_no = v_trade_no
    and r.battery_id = v_battery_id
    and r.selected_slot_num = v_slot_num
    and r.state = 'ejecting'
    and r.chargenow_status = 'release_provider_confirmation_pending'
  limit 1
  for update;

  update public.hardware_release_attempts
  set result = 'single_release',
      released_slot_nums = array[v_slot_num]::integer[],
      released_battery_ids = array[v_battery_id]::text[],
      reconciled_at = coalesce(reconciled_at, v_occurred_at),
      updated_at = now()
  where rental_session_id = v_session.id
    and result <> 'single_release';

  if not exists (
    select 1 from public.rental_orchestrator_events
    where rental_id = v_session.id
      and idempotency_key = 'battery_released:chargenow_event:' || v_event_id
  ) then
    select version into v_version
    from public.rental_orchestrator_snapshots
    where rental_id = v_session.id
    for update;

    perform public.append_rental_orchestrator_event(
      v_session.id,
      v_version,
      'battery_released',
      'battery_released:chargenow_event:' || v_event_id,
      v_occurred_at,
      jsonb_build_object(
        'source', 'chargenow_event_push',
        'stationId', v_station_id,
        'slotNum', v_slot_num,
        'batteryId', v_battery_id,
        'tradeNo', v_trade_no,
        'externalEventId', v_event_id
      ),
      'released',
      v_session.stripe_payment_intent_id,
      v_station_id,
      v_battery_id,
      null,
      null
    );
  end if;

  if not exists (
    select 1 from public.rental_orchestrator_events
    where rental_id = v_session.id
      and idempotency_key = 'rental_activated:chargenow_event:' || v_event_id
  ) then
    select version into v_version
    from public.rental_orchestrator_snapshots
    where rental_id = v_session.id
    for update;

    perform public.append_rental_orchestrator_event(
      v_session.id,
      v_version,
      'rental_activated',
      'rental_activated:chargenow_event:' || v_event_id,
      v_occurred_at,
      jsonb_build_object(
        'source', 'chargenow_event_push',
        'stationId', v_station_id,
        'slotNum', v_slot_num,
        'batteryId', v_battery_id,
        'tradeNo', v_trade_no,
        'externalEventId', v_event_id
      ),
      'active',
      v_session.stripe_payment_intent_id,
      v_station_id,
      v_battery_id,
      null,
      null
    );
  end if;

  update public.rental_sessions
  set state = 'ejected',
      ejected_at = coalesce(ejected_at, v_occurred_at),
      started_at = coalesce(started_at, v_occurred_at),
      chargenow_status = 'ejected',
      failure_code = null,
      failure_message = null
  where id = v_session.id
    and state = 'ejecting';

  return new;
exception
  when others then
    begin
      insert into public.system_incidents(type, severity, message, data, resolved, rental_session_id, station_id)
      values (
        'borrow_out_projection',
        'high',
        'BATTERY_BORROW_OUT reçu mais la projection de sortie n’a pas pu être finalisée.',
        jsonb_build_object(
          'event_id', v_event_id,
          'trade_no_fingerprint', right(coalesce(v_trade_no, ''), 8),
          'battery_id', v_battery_id,
          'slot_num', v_slot_num,
          'error', sqlerrm
        ),
        false,
        case when v_session.id is null then null else v_session.id end,
        v_station_id
      );
    exception when others then
      null;
    end;
    return new;
end;
$function$;

drop trigger if exists trg_reconcile_chargenow_borrow_out_event on public.cabinet_events;
create trigger trg_reconcile_chargenow_borrow_out_event
after insert on public.cabinet_events
for each row
when (new.event_type = 'BATTERY_BORROW_OUT')
execute function public.reconcile_chargenow_borrow_out_event();