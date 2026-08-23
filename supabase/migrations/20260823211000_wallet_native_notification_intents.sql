-- Chargeurs+ native Wallet notification intents.
-- Pass Studio currently documents lock-screen Campaign/Journey notifications in Studio,
-- but no REST endpoint for per-holder transactional campaign delivery.
-- We therefore materialize every desired native notification as an auditable intent,
-- while keeping Web Push and silent per-instance Wallet sync operational.

create table if not exists public.customer_wallet_native_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  rental_session_id uuid null references public.rental_sessions(id) on delete cascade,
  event_type text not null,
  event_key text not null unique,
  title text not null,
  message text not null,
  provider text not null default 'pass_studio',
  provider_capability text not null default 'transactional_lock_screen',
  status text not null default 'provider_capability_blocked'
    check (status in ('provider_capability_blocked','pending','delivered','failed','expired')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  delivered_at timestamptz null,
  last_error_code text null
);

create index if not exists customer_wallet_native_notifications_user_idx
  on public.customer_wallet_native_notifications(user_id, created_at desc);
create index if not exists customer_wallet_native_notifications_status_idx
  on public.customer_wallet_native_notifications(status, created_at)
  where status in ('provider_capability_blocked','pending');

alter table public.customer_wallet_native_notifications enable row level security;
revoke all on table public.customer_wallet_native_notifications from anon, authenticated;

create or replace function public.queue_customer_wallet_native_notification(
  p_user_id uuid,
  p_event_type text,
  p_event_key text,
  p_title text,
  p_message text,
  p_rental_session_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_user_id is null
     or coalesce(p_event_type,'') = ''
     or coalesce(p_event_key,'') = ''
     or coalesce(p_title,'') = ''
     or coalesce(p_message,'') = '' then
    return null;
  end if;

  if not exists (
    select 1 from public.customer_wallet_passes wp
    where wp.user_id = p_user_id
      and wp.status = 'active'
      and wp.provider = 'pass_studio'
      and wp.provider_instance_id is not null
      and wp.revoked_at is null
  ) then
    return null;
  end if;

  insert into public.customer_wallet_native_notifications(
    user_id, rental_session_id, event_type, event_key, title, message, metadata,
    status, last_error_code
  ) values (
    p_user_id, p_rental_session_id, left(p_event_type,80), left(p_event_key,220),
    left(p_title,100), left(p_message,140), coalesce(p_metadata,'{}'::jsonb),
    'provider_capability_blocked', 'PASS_STUDIO_TRANSACTIONAL_NOTIFICATION_API_UNAVAILABLE'
  )
  on conflict (event_key) do nothing
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.queue_customer_wallet_native_notification(uuid,text,text,text,text,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.queue_customer_wallet_native_notification(uuid,text,text,text,text,uuid,jsonb) to service_role;

-- Rental lifecycle: native notification intents mirror the customer-visible Web Push events.
create or replace function public.customer_wallet_realtime_rental_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  l text := case when new.customer_language in ('de','en') then new.customer_language else 'fr' end;
  v_title text;
  v_message text;
  v_amount_cents bigint;
  v_amount_text text;
begin
  if new.customer_user_id is null then return new; end if;

  if old.paid_at is null and new.paid_at is not null then
    perform public.enqueue_customer_wallet_sync_event(
      new.customer_user_id, 'payment_secured', 'wallet:rental:' || new.id || ':payment_secured', new.id,
      jsonb_build_object('stationId', new.station_id), now() + interval '2 hours'
    );
    v_title := case l when 'de' then 'Zahlung bestätigt' when 'en' then 'Payment confirmed' else 'Paiement confirmé' end;
    v_message := case l when 'de' then 'Ihre Mietgarantie ist bestätigt. Die Miete startet nach der physischen Ausgabe.' when 'en' then 'Your rental guarantee is confirmed. Rental starts after physical release.' else 'Votre garantie est confirmée. La location démarre après la sortie physique.' end;
    perform public.queue_customer_wallet_native_notification(new.customer_user_id,'payment_secured','native:rental:'||new.id||':payment_secured',v_title,v_message,new.id,jsonb_build_object('stationId',new.station_id));
  end if;

  if old.ejected_at is null and new.ejected_at is not null then
    perform public.enqueue_customer_wallet_sync_event(
      new.customer_user_id, 'rental_started', 'wallet:rental:' || new.id || ':started', new.id,
      jsonb_build_object('stationId', new.station_id), now() + interval '2 hours'
    );
    v_amount_cents := case when coalesce(new.pricing_snapshot->>'final_cents','') ~ '^[0-9]+$' then (new.pricing_snapshot->>'final_cents')::bigint else null end;
    v_amount_text := case when v_amount_cents is null then null else upper(coalesce(nullif(new.currency,''),'CHF')) || ' ' || to_char(v_amount_cents::numeric / 100, 'FM999999990.00') end;
    v_title := case l when 'de' then 'Miete gestartet' when 'en' then 'Rental started' else 'Location démarrée' end;
    v_message := case l when 'de' then 'Ihre Powerbank ist ausgegeben.' || case when v_amount_text is null then '' else ' Aktuelle Kosten: '||v_amount_text||'.' end when 'en' then 'Your powerbank is out.' || case when v_amount_text is null then '' else ' Current cost: '||v_amount_text||'.' end else 'Votre batterie est sortie.' || case when v_amount_text is null then '' else ' Coût actuel : '||v_amount_text||'.' end end;
    perform public.queue_customer_wallet_native_notification(new.customer_user_id,'rental_started','native:rental:'||new.id||':started',v_title,v_message,new.id,jsonb_build_object('currentAmountCents',v_amount_cents,'currency',new.currency));
  end if;

  if old.returned_at is null and new.returned_at is not null then
    perform public.enqueue_customer_wallet_sync_event(
      new.customer_user_id, 'return_detected', 'wallet:rental:' || new.id || ':returned', new.id,
      jsonb_build_object('returnStationId', new.return_station_id), now() + interval '2 hours'
    );
    v_title := case l when 'de' then 'Rückgabe erkannt' when 'en' then 'Return detected' else 'Retour détecté' end;
    v_message := case l when 'de' then 'Ihre Powerbank wurde erkannt. Der Endbetrag wird berechnet.' when 'en' then 'Your powerbank was detected. The final amount is being calculated.' else 'Votre batterie a été reconnue. Le montant final est en cours de calcul.' end;
    perform public.queue_customer_wallet_native_notification(new.customer_user_id,'return_detected','native:rental:'||new.id||':returned',v_title,v_message,new.id,jsonb_build_object('returnStationId',new.return_station_id));
  end if;

  if old.settlement_status is distinct from new.settlement_status and new.settlement_status = 'settled' then
    perform public.enqueue_customer_wallet_sync_event(
      new.customer_user_id, 'rental_settled', 'wallet:rental:' || new.id || ':settled', new.id,
      jsonb_build_object('finalAmountCents', new.final_amount_cents, 'currency', new.currency), now() + interval '24 hours'
    );
    v_amount_cents := coalesce(new.final_amount_cents,new.captured_amount_cents,0);
    v_amount_text := upper(coalesce(nullif(new.currency,''),'CHF')) || ' ' || to_char(v_amount_cents::numeric / 100, 'FM999999990.00');
    v_title := case l when 'de' then 'Miete abgeschlossen' when 'en' then 'Rental completed' else 'Location terminée' end;
    v_message := case l when 'de' then 'Ihre Miete ist abgeschlossen. Endbetrag: '||v_amount_text||'.' when 'en' then 'Your rental is complete. Final amount: '||v_amount_text||'.' else 'Votre location est terminée. Montant final : '||v_amount_text||'.' end;
    perform public.queue_customer_wallet_native_notification(new.customer_user_id,'rental_completed','native:rental:'||new.id||':settled',v_title,v_message,new.id,jsonb_build_object('finalAmountCents',v_amount_cents,'currency',new.currency));
  end if;

  if ((old.state is distinct from new.state and new.state in ('payment_failed','needs_support'))
      or (old.settlement_status is distinct from new.settlement_status and new.settlement_status in ('failed','manual_review'))) then
    perform public.enqueue_customer_wallet_sync_event(
      new.customer_user_id, 'rental_issue',
      'wallet:rental:' || new.id || ':issue:' || coalesce(new.state,'') || ':' || coalesce(new.settlement_status,''),
      new.id, jsonb_build_object('state',new.state,'settlementStatus',new.settlement_status), now() + interval '2 hours'
    );
    v_title := case l when 'de' then 'Aktion erforderlich' when 'en' then 'Action required' else 'Action requise' end;
    v_message := case l when 'de' then 'Ihre Miete benötigt eine Überprüfung. Öffnen Sie Chargeurs+ für den aktuellen Status.' when 'en' then 'Your rental needs review. Open Chargeurs+ for the current status.' else 'Votre location nécessite une vérification. Ouvrez Chargeurs+ pour voir l’état actuel.' end;
    perform public.queue_customer_wallet_native_notification(new.customer_user_id,'rental_issue','native:rental:'||new.id||':issue:'||coalesce(new.state,'')||':'||coalesce(new.settlement_status,''),v_title,v_message,new.id,jsonb_build_object('state',new.state,'settlementStatus',new.settlement_status));
  end if;

  return new;
end;
$$;

-- Price-stage scanner: create native intent exactly when a new canonical amount is materialized.
create or replace function public.queue_due_customer_wallet_price_transitions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_enabled boolean := false;
  v_enabled_from timestamptz := now();
  v_pricing jsonb;
  v_amount integer;
  v_initial integer;
  v_currency text;
  v_cap boolean;
  v_event_id uuid;
  v_count integer := 0;
  v_lang text;
  v_title text;
  v_body text;
  v_amount_text text;
begin
  select coalesce((value->>'enabled')::boolean,false), coalesce(nullif(value->>'enabled_from','')::timestamptz,now())
    into v_enabled,v_enabled_from from public.app_settings where key='customer_wallet.realtime';
  if not coalesce(v_enabled,false) then return 0; end if;

  for r in
    select rs.* from public.rental_sessions rs
    where rs.customer_user_id is not null
      and coalesce(rs.started_at,rs.ejected_at) is not null
      and coalesce(rs.started_at,rs.ejected_at) >= v_enabled_from
      and rs.returned_at is null
      and rs.state not in ('completed','cancelled','payment_failed','expired')
      and exists (select 1 from public.customer_wallet_passes wp where wp.user_id=rs.customer_user_id and wp.status='active' and wp.revoked_at is null and wp.provider='pass_studio' and wp.provider_instance_id is not null)
  loop
    v_pricing := public.customer_wallet_pricing_state(r.pricing_snapshot,coalesce(r.started_at,r.ejected_at),now());
    if v_pricing is null then continue; end if;
    v_amount := coalesce(nullif(v_pricing->>'final_cents','')::integer,0);
    v_initial := coalesce(nullif(r.pricing_snapshot->>'final_cents','')::integer,v_amount);
    if v_amount = v_initial then continue; end if;
    v_currency := upper(coalesce(nullif(v_pricing->>'currency',''),nullif(r.currency,''),'CHF'));
    v_cap := coalesce((v_pricing->>'cap_reached')::boolean,false);
    v_event_id := public.enqueue_customer_wallet_sync_event(r.customer_user_id,case when v_cap then 'daily_cap_reached' else 'price_stage_changed' end,'wallet:rental:'||r.id||':price:'||v_amount,r.id,jsonb_build_object('currentAmountCents',v_amount,'currency',v_currency,'capReached',v_cap,'totalMinutes',v_pricing->>'total_minutes'),now()+interval '30 minutes');
    if v_event_id is not null then
      v_count := v_count + 1;
      v_lang := case when r.customer_language in ('de','en') then r.customer_language else 'fr' end;
      v_amount_text := v_currency || ' ' || to_char(v_amount::numeric/100,'FM999999990.00');
      if v_cap then
        v_title := case v_lang when 'de' then 'Tageslimit erreicht' when 'en' then 'Daily cap reached' else 'Plafond journalier atteint' end;
        v_body := case v_lang when 'de' then 'Ihre aktuellen Mietkosten betragen '||v_amount_text||'. Das Tageslimit ist erreicht.' when 'en' then 'Your current rental cost is '||v_amount_text||'. The daily cap has been reached.' else 'Votre location est à '||v_amount_text||'. Le plafond journalier est atteint.' end;
      else
        v_title := case v_lang when 'de' then 'Mietpreis aktualisiert' when 'en' then 'Rental price updated' else 'Tarif de location mis à jour' end;
        v_body := case v_lang when 'de' then 'Ihre Miete kostet jetzt '||v_amount_text||'.' when 'en' then 'Your rental now costs '||v_amount_text||'.' else 'Votre location est maintenant à '||v_amount_text||'.' end;
      end if;
      perform public.queue_customer_push_notification(r.customer_user_id,case when v_cap then 'daily_cap_reached' else 'price_stage_changed' end,v_title,v_body,'/compte/pass','push:rental:'||r.id||':price:'||v_amount,jsonb_build_object('rentalSessionId',r.id,'currentAmountCents',v_amount,'currency',v_currency,'capReached',v_cap));
      perform public.queue_customer_wallet_native_notification(r.customer_user_id,case when v_cap then 'daily_cap_reached' else 'price_stage_changed' end,'native:rental:'||r.id||':price:'||v_amount,v_title,v_body,r.id,jsonb_build_object('currentAmountCents',v_amount,'currency',v_currency,'capReached',v_cap));
    end if;
  end loop;
  return v_count;
end;
$$;

-- ChargePoints: rental points are folded into the final rental message; non-rental bonuses get their own native intent.
create or replace function public.customer_wallet_chargepoints_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_body text;
begin
  perform public.enqueue_customer_wallet_sync_event(new.user_id,'chargepoints_changed','wallet:chargepoints:'||new.id,case when new.source_type='rental' and coalesce(new.source_id,'') ~ '^[0-9a-fA-F-]{36}$' then new.source_id::uuid else null end,jsonb_build_object('delta',new.delta,'reason',new.reason,'sourceType',new.source_type),now()+interval '24 hours');
  if new.source_type <> 'rental' and new.delta > 0 then
    v_title := 'ChargePoints ajoutés';
    v_body := '+'||new.delta||' ChargePoints ont été ajoutés à votre Pass Chargeurs+.';
    perform public.queue_customer_push_notification(new.user_id,'chargepoints_bonus',v_title,v_body,'/compte/pass','push:chargepoints:'||new.id,jsonb_build_object('delta',new.delta,'reason',new.reason));
    perform public.queue_customer_wallet_native_notification(new.user_id,'chargepoints_bonus','native:chargepoints:'||new.id,v_title,v_body,null,jsonb_build_object('delta',new.delta,'reason',new.reason));
  end if;
  return new;
end;
$$;

-- Membership lifecycle native intents.
create or replace function public.customer_wallet_membership_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_message text;
  v_event text;
begin
  if old.status is distinct from new.status
     or old.cancel_at_period_end is distinct from new.cancel_at_period_end
     or old.renews_at is distinct from new.renews_at
     or old.ends_at is distinct from new.ends_at
     or old.stripe_current_period_end is distinct from new.stripe_current_period_end then
    perform public.enqueue_customer_wallet_sync_event(new.user_id,'membership_changed','wallet:membership:'||new.id||':'||md5(concat_ws(':',new.status,new.cancel_at_period_end::text,coalesce(new.renews_at::text,''),coalesce(new.ends_at::text,''),coalesce(new.stripe_current_period_end::text,''))),null,jsonb_build_object('membershipId',new.id,'status',new.status,'cancelAtPeriodEnd',new.cancel_at_period_end),now()+interval '24 hours');

    if new.cancel_at_period_end = true and coalesce(old.cancel_at_period_end,false) = false then
      v_event := 'membership_cancellation_scheduled'; v_title := 'Résiliation programmée'; v_message := 'Votre Pass Chargeurs+ reste actif jusqu’à la fin de votre période en cours.';
    elsif new.status in ('canceled','expired') and old.status is distinct from new.status then
      v_event := 'membership_expired'; v_title := 'Pass Chargeurs+ arrivé à échéance'; v_message := 'Votre adhésion Chargeurs+ n’est plus active.';
    elsif new.status in ('active','trialing') and old.status is distinct from new.status then
      v_event := 'membership_active'; v_title := 'Chargeurs+ actif'; v_message := 'Votre adhésion Chargeurs+ est active et votre Pass a été mis à jour.';
    elsif new.renews_at is distinct from old.renews_at or new.stripe_current_period_end is distinct from old.stripe_current_period_end then
      v_event := 'membership_renewed'; v_title := 'Chargeurs+ renouvelé'; v_message := 'Votre adhésion Chargeurs+ a été renouvelée et votre nouvelle échéance est disponible dans le Pass.';
    else
      v_event := null;
    end if;

    if v_event is not null then
      perform public.queue_customer_wallet_native_notification(new.user_id,v_event,'native:membership:'||new.id||':'||md5(concat_ws(':',v_event,new.status,new.cancel_at_period_end::text,coalesce(new.renews_at::text,''),coalesce(new.stripe_current_period_end::text,''))),v_title,v_message,null,jsonb_build_object('membershipId',new.id,'status',new.status));
    end if;
  end if;
  return new;
end;
$$;
