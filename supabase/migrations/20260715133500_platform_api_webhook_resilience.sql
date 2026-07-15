-- Webhook delivery must never roll back a rental state transition.
-- Replace the trigger function with a best-effort variant that records an
-- operational incident when enqueueing fails, then returns the rental row.

create or replace function public.emit_rental_platform_api_webhook()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_type text;
  v_payload jsonb;
begin
  if new.api_client_id is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_event_type := 'rental.created';
  elsif old.state is not distinct from new.state then
    return new;
  else
    v_event_type := case new.state
      when 'checkout_created' then 'rental.checkout_created'
      when 'payment_succeeded' then 'rental.payment_succeeded'
      when 'ejected' then 'rental.ejected'
      when 'battery_taken' then 'rental.active'
      when 'active_rental' then 'rental.active'
      when 'battery_returned' then 'rental.returned'
      when 'returned' then 'rental.returned'
      when 'closed' then 'rental.completed'
      when 'completed' then 'rental.completed'
      when 'payment_cancelled' then 'rental.cancelled'
      when 'cancelled' then 'rental.cancelled'
      when 'refunded' then 'rental.refunded'
      when 'needs_support' then 'rental.incident'
      when 'eject_failed' then 'rental.incident'
      else 'rental.state_changed'
    end;
  end if;

  v_payload := jsonb_build_object(
    'rentalId', new.id,
    'publicSessionCode', new.public_session_code,
    'externalReference', new.external_reference,
    'stationId', new.station_id,
    'state', new.state,
    'previousState', case when tg_op = 'UPDATE' then old.state else null end,
    'currency', new.currency,
    'amountExpected', new.amount_expected,
    'amountPaid', new.amount_paid,
    'failureCode', new.failure_code,
    'startedAt', new.started_at,
    'returnedAt', new.returned_at,
    'closedAt', new.closed_at,
    'updatedAt', new.updated_at
  );

  begin
    perform public.enqueue_platform_api_webhook_event(
      new.api_client_id,
      v_event_type,
      'rental',
      new.id::text,
      v_payload
    );
  exception when others then
    begin
      insert into public.system_incidents (
        type,
        severity,
        message,
        data,
        resolved
      ) values (
        'platform_api_webhook_enqueue_failed',
        'warning',
        'La location a été enregistrée, mais son événement webhook n’a pas pu être mis en file.',
        jsonb_build_object(
          'rental_session_id', new.id,
          'api_client_id', new.api_client_id,
          'event_type', v_event_type,
          'sqlstate', sqlstate
        ),
        false
      );
    exception when others then
      null;
    end;
  end;

  return new;
end;
$$;
