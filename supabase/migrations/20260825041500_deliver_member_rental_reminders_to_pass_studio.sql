-- A Chargeurs+ member may have a PassStudio Wallet pass without opting in to
-- browser push.  Rental state and return reminders must still reach that pass.
-- This only queues Wallet messages; it never changes a rental, a balance, a
-- payment, or a physical-borne action.

create or replace function public.queue_customer_wallet_native_notification(
  p_user_id uuid,
  p_event_type text,
  p_event_key text,
  p_title text,
  p_message text,
  p_metadata jsonb default '{}'::jsonb,
  p_expires_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_id uuid;
begin
  if p_user_id is null
     or coalesce(trim(p_event_type), '') = ''
     or coalesce(trim(p_event_key), '') = ''
     or coalesce(trim(p_title), '') = '' then
    return null;
  end if;

  if not exists (
    select 1
    from public.customer_wallet_passes wp
    where wp.user_id = p_user_id
      and wp.status = 'active'
      and wp.revoked_at is null
      and wp.provider = 'pass_studio'
      and wp.provider_instance_id is not null
  ) then
    return null;
  end if;

  insert into public.customer_wallet_native_notifications(
    user_id, event_type, event_key, title, message, metadata,
    provider, provider_capability, status, attempts, next_attempt_at,
    expires_at, last_error_code
  ) values (
    p_user_id,
    left(p_event_type, 80),
    left(p_event_key, 220),
    left(p_title, 100),
    left(coalesce(p_message, p_title), 140),
    coalesce(p_metadata, '{}'::jsonb),
    'pass_studio',
    'instances_fields_message',
    'pending',
    0,
    now(),
    coalesce(p_expires_at, now() + interval '2 hours'),
    null
  ) on conflict (event_key) do nothing
  returning id into v_id;

  return v_id;
end;
$function$;

-- This helper is used only by trusted database triggers and scheduled jobs.
revoke all on function public.queue_customer_wallet_native_notification(uuid, text, text, text, text, jsonb, timestamptz)
  from public, anon, authenticated;

create or replace function public.customer_wallet_native_rental_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_has_web_push boolean := false;
  v_web_push_delivery_enabled boolean := false;
  v_web_push_send_after timestamptz;
  v_language text := case when new.customer_language in ('de', 'en') then new.customer_language else 'fr' end;
  v_title text;
  v_body text;
  v_amount_cents bigint;
  v_amount_text text;
begin
  if new.customer_user_id is null then
    return new;
  end if;

  -- When a web-push subscription exists, its existing trigger also creates the
  -- corresponding native Wallet message.  This trigger is the Pass-only
  -- fallback, so a customer never receives the same event twice.
  select exists (
    select 1
    from public.customer_push_subscriptions s
    where s.user_id = new.customer_user_id
      and s.enabled
      and s.revoked_at is null
  ) into v_has_web_push;
  select coalesce((value->>'enabled')::boolean, false),
         nullif(value->>'send_after', '')::timestamptz
    into v_web_push_delivery_enabled, v_web_push_send_after
  from public.app_settings
  where key = 'customer_push.delivery';
  if v_has_web_push
     and coalesce(v_web_push_delivery_enabled, false)
     and (v_web_push_send_after is null or now() >= v_web_push_send_after) then
    return new;
  end if;

  if old.ejected_at is null and new.ejected_at is not null then
    v_amount_cents := case
      when coalesce(new.pricing_snapshot->>'final_cents', '') ~ '^[0-9]+$'
        then (new.pricing_snapshot->>'final_cents')::bigint
      else null
    end;
    v_amount_text := case
      when v_amount_cents is null then null
      else upper(coalesce(nullif(new.currency, ''), 'CHF')) || ' ' || to_char(v_amount_cents::numeric / 100, 'FM999999990.00')
    end;
    v_title := case v_language
      when 'de' then 'Ihre Powerbank ist ausgegeben'
      when 'en' then 'Your powerbank is out'
      else 'Votre batterie est sortie'
    end;
    v_body := case v_language
      when 'de' then 'Die physische Ausgabe wurde bestätigt. Ihre Miete läuft jetzt.' || case when v_amount_text is null then '' else ' Aktuelle Kosten: ' || v_amount_text || '.' end
      when 'en' then 'Physical release is confirmed. Your rental is now active.' || case when v_amount_text is null then '' else ' Current cost: ' || v_amount_text || '.' end
      else 'La sortie physique est confirmée. Votre location est maintenant active.' || case when v_amount_text is null then '' else ' Coût actuel : ' || v_amount_text || '.' end
    end;
    perform public.queue_customer_wallet_native_notification(
      new.customer_user_id, 'rental_started', 'native:rental:' || new.id || ':started',
      v_title, v_body,
      jsonb_build_object('rentalSessionId', new.id, 'stationId', new.station_id, 'batteryId', new.battery_id, 'currentAmountCents', v_amount_cents, 'currency', new.currency),
      now() + interval '2 hours'
    );
  end if;

  if old.returned_at is null and new.returned_at is not null then
    v_title := case v_language
      when 'de' then 'Rückgabe erkannt'
      when 'en' then 'Return detected'
      else 'Retour détecté'
    end;
    v_body := case v_language
      when 'de' then 'Ihre Powerbank wurde erkannt. Der Endbetrag wird jetzt berechnet.'
      when 'en' then 'Your powerbank was detected. The final amount is now being calculated.'
      else 'Votre batterie a été reconnue. Le montant final est maintenant calculé.'
    end;
    perform public.queue_customer_wallet_native_notification(
      new.customer_user_id, 'return_detected', 'native:rental:' || new.id || ':returned',
      v_title, v_body,
      jsonb_build_object('rentalSessionId', new.id, 'returnStationId', new.return_station_id),
      now() + interval '2 hours'
    );
  end if;

  if old.settlement_status is distinct from new.settlement_status
     and new.settlement_status = 'settled' then
    v_amount_cents := coalesce(new.final_amount_cents, new.captured_amount_cents, 0);
    v_amount_text := upper(coalesce(nullif(new.currency, ''), 'CHF')) || ' ' || to_char(v_amount_cents::numeric / 100, 'FM999999990.00');
    v_title := case v_language
      when 'de' then 'Miete abgeschlossen'
      when 'en' then 'Rental completed'
      else 'Location terminée'
    end;
    v_body := case v_language
      when 'de' then 'Ihre Miete ist abgeschlossen. Endbetrag: ' || v_amount_text || '.'
      when 'en' then 'Your rental is complete. Final amount: ' || v_amount_text || '.'
      else 'Votre location est terminée. Montant final : ' || v_amount_text || '.'
    end;
    perform public.queue_customer_wallet_native_notification(
      new.customer_user_id, 'rental_completed', 'native:rental:' || new.id || ':settled',
      v_title, v_body,
      jsonb_build_object('rentalSessionId', new.id, 'finalAmountCents', new.final_amount_cents, 'capturedAmountCents', new.captured_amount_cents, 'currency', new.currency),
      now() + interval '24 hours'
    );
  end if;

  if (old.state is distinct from new.state and new.state in ('payment_failed', 'needs_support'))
     or (old.settlement_status is distinct from new.settlement_status and new.settlement_status in ('failed', 'manual_review')) then
    v_title := case v_language
      when 'de' then 'Aktion erforderlich'
      when 'en' then 'Action required'
      else 'Action requise'
    end;
    v_body := case v_language
      when 'de' then 'Ihre Miete benötigt eine sichere Überprüfung. Öffnen Sie Chargeurs+ für den aktuellen Status.'
      when 'en' then 'Your rental needs a secure review. Open Chargeurs+ for the current status.'
      else 'Votre location nécessite une vérification sécurisée. Ouvrez Chargeurs+ pour consulter l’état actuel.'
    end;
    perform public.queue_customer_wallet_native_notification(
      new.customer_user_id, 'rental_issue',
      'native:rental:' || new.id || ':issue:' || coalesce(new.state, '') || ':' || coalesce(new.settlement_status, ''),
      v_title, v_body,
      jsonb_build_object('rentalSessionId', new.id, 'state', new.state, 'settlementStatus', new.settlement_status),
      now() + interval '4 hours'
    );
  end if;

  return new;
end;
$function$;

drop trigger if exists customer_wallet_native_rental_events_trg on public.rental_sessions;
create trigger customer_wallet_native_rental_events_trg
after update on public.rental_sessions
for each row execute function public.customer_wallet_native_rental_events();

create or replace function public.queue_due_customer_rental_push_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  r record;
  threshold integer;
  queued integer := 0;
  l text;
  t text;
  b text;
  out_id uuid;
  native_id uuid;
  send_after timestamptz;
begin
  select nullif(value->>'send_after', '')::timestamptz
    into send_after
  from public.app_settings
  where key = 'customer_push.delivery';

  for r in
    select rs.*
    from public.rental_sessions rs
    where rs.customer_user_id is not null
      and rs.ejected_at is not null
      and rs.returned_at is null
      and rs.closed_at is null
      and (send_after is null or rs.ejected_at >= send_after)
      and rs.state not in ('completed', 'expired', 'payment_failed', 'needs_support')
  loop
    l := case when r.customer_language in ('de', 'en') then r.customer_language else 'fr' end;
    -- 23 hours is deliberately a reminder, not an invented contractual
    -- deadline.  It gives the customer time to return a battery they no
    -- longer need before a full day of rental has elapsed.
    foreach threshold in array array[30, 120, 360, 1380] loop
      if extract(epoch from (now() - r.ejected_at)) / 60 >= threshold then
        if threshold = 1380 then
          t := case l
            when 'de' then 'Rückgabe der Powerbank planen'
            when 'en' then 'Plan your powerbank return'
            else 'Pensez à rendre votre batterie'
          end;
          b := case l
            when 'de' then 'Ihre Miete läuft seit fast 24 Stunden. Wenn Sie die Powerbank nicht mehr benötigen, geben Sie sie bitte an einer kompatiblen Chargeurs.ch Station zurück.'
            when 'en' then 'Your rental has been active for almost 24 hours. If you no longer need the powerbank, please return it at a compatible Chargeurs.ch station.'
            else 'Votre location approche 24 heures. Si vous n’avez plus besoin de la batterie, pensez à la rendre dans une borne Chargeurs.ch compatible.'
          end;
        else
          t := case l
            when 'de' then 'Ihre Miete läuft noch'
            when 'en' then 'Your rental is still active'
            else 'Votre location est toujours en cours'
          end;
          b := case l
            when 'de' then format('Seit %s Minuten aktiv. Sie können die Powerbank an einer kompatiblen Chargeurs.ch Station zurückgeben.', threshold)
            when 'en' then format('Active for %s minutes. You can return the powerbank at a compatible Chargeurs.ch station.', threshold)
            else format('Active depuis %s minutes. Vous pouvez rendre la batterie dans une borne Chargeurs.ch compatible.', threshold)
          end;
        end if;

        out_id := public.queue_customer_push_notification(
          r.customer_user_id, 'rental_reminder', t, b, '/compte/locations',
          'push:rental:' || r.id || ':reminder:' || threshold,
          jsonb_build_object('rentalSessionId', r.id, 'elapsedMinutes', threshold)
        );

        -- A non-null web-push row is mirrored to PassStudio by the existing
        -- notification trigger.  Otherwise, queue the Wallet reminder itself.
        native_id := null;
        if out_id is null then
          native_id := public.queue_customer_wallet_native_notification(
            r.customer_user_id, 'rental_reminder',
            'native:rental:' || r.id || ':reminder:' || threshold,
            t, b,
            jsonb_build_object('rentalSessionId', r.id, 'elapsedMinutes', threshold),
            now() + interval '2 hours'
          );
        end if;

        if out_id is not null or native_id is not null then
          queued := queued + 1;
        end if;
      end if;
    end loop;
  end loop;

  return queued;
end;
$function$;
