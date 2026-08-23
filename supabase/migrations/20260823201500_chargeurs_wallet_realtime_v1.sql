-- Chargeurs+ Wallet realtime v1
-- Wallet delivery is deliberately asynchronous: rental/payment/return/settlement paths never call Pass Studio.

create table if not exists public.customer_wallet_sync_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  rental_session_id uuid null references public.rental_sessions(id) on delete cascade,
  event_type text not null,
  event_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','processing','delivered','failed','expired')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  expires_at timestamptz null,
  last_error_code text null,
  delivered_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customer_wallet_sync_outbox_pending_idx
  on public.customer_wallet_sync_outbox(next_attempt_at, created_at)
  where status = 'pending';
create index if not exists customer_wallet_sync_outbox_user_idx
  on public.customer_wallet_sync_outbox(user_id, created_at desc);

alter table public.customer_wallet_sync_outbox enable row level security;
revoke all on table public.customer_wallet_sync_outbox from anon, authenticated;

insert into public.app_settings(key, value)
values (
  'customer_wallet.realtime',
  jsonb_build_object('enabled', true, 'enabled_from', now(), 'scanner_seconds', 10)
)
on conflict (key) do nothing;

create or replace function public.enqueue_customer_wallet_sync_event(
  p_user_id uuid,
  p_event_type text,
  p_event_key text,
  p_rental_session_id uuid default null,
  p_payload jsonb default '{}'::jsonb,
  p_expires_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_user_id is null or coalesce(p_event_type, '') = '' or coalesce(p_event_key, '') = '' then
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

  insert into public.customer_wallet_sync_outbox(
    user_id, rental_session_id, event_type, event_key, payload, expires_at
  ) values (
    p_user_id, p_rental_session_id, left(p_event_type, 80), left(p_event_key, 220), coalesce(p_payload, '{}'::jsonb), p_expires_at
  )
  on conflict (event_key) do nothing
  returning id into v_id;

  if v_id is not null then
    update public.customer_wallet_passes
    set provider_status = case when provider_status = 'issued' then 'update_pending' else provider_status end,
        updated_at = now()
    where user_id = p_user_id
      and status = 'active'
      and revoked_at is null
      and provider = 'pass_studio'
      and provider_instance_id is not null;
  end if;

  return v_id;
end;
$$;

create or replace function public.customer_wallet_pricing_state(
  p_snapshot jsonb,
  p_start timestamptz,
  p_at timestamptz default now()
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_at timestamptz := coalesce(p_at, now());
  v_total_min integer := 0;
  v_billable_min integer := 0;
  v_periods integer := 0;
  v_initial integer := 0;
  v_duration integer := 0;
  v_subtotal integer := 0;
  v_capped integer := 0;
  v_final integer := 0;
  v_tax integer := 0;
  v_days integer := 1;
  v_tiered boolean := false;
  v_tiers jsonb := '[]'::jsonb;
  v_upper integer;
  v_last_upper integer := 0;
  v_last_total integer := 0;
  v_period_minutes integer := 0;
  v_price_per_period integer := 0;
  v_included integer := 0;
  v_grace integer := 0;
  v_daily_cap integer := 0;
  v_total_cap integer := 0;
  v_max_amount integer := 0;
  v_min_amount integer := 0;
  v_tax_percent numeric := 0;
  v_rounding text := 'none';
  v_cap_reached boolean := false;
  v_currency text := 'CHF';
begin
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' or p_start is null then
    return null;
  end if;

  v_total_min := greatest(0, ceil(extract(epoch from (greatest(v_at, p_start) - p_start)) / 60.0)::integer);
  v_initial := coalesce(nullif(p_snapshot->>'initial_fee_cents', '')::integer, 0);
  v_period_minutes := coalesce(nullif(p_snapshot->>'period_minutes', '')::integer, 0);
  v_price_per_period := coalesce(nullif(p_snapshot->>'price_per_period_cents', '')::integer, 0);
  v_included := coalesce(nullif(p_snapshot->>'included_minutes', '')::integer, 0);
  v_grace := coalesce(nullif(p_snapshot->>'grace_minutes', '')::integer, 0);
  v_daily_cap := coalesce(nullif(p_snapshot->>'daily_cap_cents', '')::integer, 0);
  v_total_cap := coalesce(nullif(p_snapshot->>'total_cap_cents', '')::integer, 0);
  v_max_amount := coalesce(nullif(p_snapshot->>'max_amount_cents', '')::integer, 0);
  v_min_amount := coalesce(nullif(p_snapshot->>'min_amount_cents', '')::integer, 0);
  v_tax_percent := coalesce(nullif(p_snapshot->>'tax_percent', '')::numeric, 0);
  v_rounding := coalesce(nullif(p_snapshot->>'rounding', ''), 'none');
  v_currency := upper(coalesce(nullif(p_snapshot->>'currency', ''), 'CHF'));
  v_tiers := case when jsonb_typeof(p_snapshot->'tiers') = 'array' then p_snapshot->'tiers' else '[]'::jsonb end;
  v_tiered := coalesce(nullif(p_snapshot->>'tiered', '')::boolean, jsonb_array_length(v_tiers) > 0);

  if v_tiered then
    select (t->>'upper_minutes')::integer, (t->>'total_cents')::integer
      into v_upper, v_duration
    from jsonb_array_elements(v_tiers) t
    where coalesce(t->>'upper_minutes', '') ~ '^[0-9]+$'
      and coalesce(t->>'total_cents', '') ~ '^[0-9]+$'
      and (t->>'upper_minutes')::integer >= greatest(v_total_min, 1)
    order by (t->>'upper_minutes')::integer asc
    limit 1;

    if v_duration is null then
      select (t->>'upper_minutes')::integer, (t->>'total_cents')::integer
        into v_last_upper, v_last_total
      from jsonb_array_elements(v_tiers) t
      where coalesce(t->>'upper_minutes', '') ~ '^[0-9]+$'
        and coalesce(t->>'total_cents', '') ~ '^[0-9]+$'
      order by (t->>'upper_minutes')::integer desc
      limit 1;

      if v_period_minutes <= 0 or v_price_per_period < 0 then
        return null;
      end if;
      v_periods := ceil(greatest(v_total_min - v_last_upper, 0)::numeric / v_period_minutes)::integer;
      v_duration := v_last_total + (v_periods * v_price_per_period);
    end if;
  else
    if v_total_min = 0 then
      v_periods := case when v_price_per_period > 0 then greatest(1, coalesce(nullif(p_snapshot->>'billed_periods', '')::integer, 1)) else 0 end;
    elsif v_total_min <= v_included + v_grace then
      v_periods := 0;
    else
      v_billable_min := v_total_min - v_included;
      if v_period_minutes <= 0 then return null; end if;
      v_periods := ceil(v_billable_min::numeric / v_period_minutes)::integer;
    end if;
    v_duration := v_periods * v_price_per_period;
  end if;

  v_subtotal := v_initial + coalesce(v_duration, 0);
  v_capped := v_subtotal;

  if v_daily_cap > 0 and not v_tiered then
    v_days := greatest(1, ceil(v_total_min::numeric / 1440)::integer);
    if v_capped > v_daily_cap * v_days then
      v_capped := v_daily_cap * v_days;
      v_cap_reached := true;
    end if;
  end if;
  if v_total_cap > 0 and v_capped > v_total_cap then v_capped := v_total_cap; v_cap_reached := true; end if;
  if v_max_amount > 0 and v_capped > v_max_amount then v_capped := v_max_amount; v_cap_reached := true; end if;
  if v_min_amount > 0 and v_capped < v_min_amount then v_capped := v_min_amount; end if;

  if v_rounding = 'up_5' then v_capped := (ceil(v_capped::numeric / 5) * 5)::integer;
  elsif v_rounding = 'up_10' then v_capped := (ceil(v_capped::numeric / 10) * 10)::integer;
  end if;

  v_tax := round(v_capped * v_tax_percent / 100.0)::integer;
  v_final := v_capped + v_tax;

  return jsonb_build_object(
    'final_cents', v_final,
    'currency', v_currency,
    'total_minutes', v_total_min,
    'billed_periods', v_periods,
    'cap_reached', v_cap_reached,
    'tiered', v_tiered
  );
exception
  when others then
    return null;
end;
$$;

create or replace function public.customer_wallet_presentation_state(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_points integer := 0;
  v_rental public.rental_sessions%rowtype;
  v_pricing jsonb;
  v_amount integer;
  v_currency text := 'CHF';
  v_tier text;
  v_membership_status text;
  v_cancel_at_period_end boolean := false;
  v_membership_end timestamptz;
  v_plan_name text;
begin
  select coalesce(balance, 0) into v_points
  from public.customer_chargepoints_balances
  where user_id = p_user_id;
  v_points := coalesce(v_points, 0);

  select * into v_rental
  from public.rental_sessions
  where customer_user_id = p_user_id
    and coalesce(started_at, ejected_at) is not null
    and returned_at is null
    and state not in ('completed','cancelled','payment_failed','expired')
  order by created_at desc
  limit 1;

  if v_rental.id is not null then
    if v_rental.state in ('needs_support','manual_review') or v_rental.settlement_status in ('failed','manual_review') then
      v_tier := 'Action requise';
    else
      v_pricing := public.customer_wallet_pricing_state(v_rental.pricing_snapshot, coalesce(v_rental.started_at, v_rental.ejected_at), now());
      v_amount := coalesce(nullif(v_pricing->>'final_cents', '')::integer, nullif(v_rental.pricing_snapshot->>'final_cents', '')::integer, 0);
      v_currency := upper(coalesce(nullif(v_pricing->>'currency', ''), nullif(v_rental.currency, ''), 'CHF'));
      if coalesce((v_pricing->>'cap_reached')::boolean, false) then
        v_tier := 'Plafond atteint · ' || v_currency || ' ' || to_char(v_amount::numeric / 100, 'FM999999990.00');
      else
        v_tier := 'Location · ' || v_currency || ' ' || to_char(v_amount::numeric / 100, 'FM999999990.00');
      end if;
    end if;
  else
    select * into v_rental
    from public.rental_sessions
    where customer_user_id = p_user_id
      and returned_at is not null
      and coalesce(settlement_status, '') <> 'settled'
    order by returned_at desc
    limit 1;

    if v_rental.id is not null then
      v_tier := 'Retour détecté';
    else
      select * into v_rental
      from public.rental_sessions
      where customer_user_id = p_user_id
        and settlement_status = 'settled'
        and settled_at >= now() - interval '24 hours'
      order by settled_at desc
      limit 1;

      if v_rental.id is not null then
        v_amount := coalesce(v_rental.final_amount_cents, v_rental.captured_amount_cents, 0);
        v_currency := upper(coalesce(nullif(v_rental.currency, ''), 'CHF'));
        v_tier := 'Terminé · ' || v_currency || ' ' || to_char(v_amount::numeric / 100, 'FM999999990.00');
      else
        select m.status,
               coalesce(m.cancel_at_period_end, false),
               coalesce(m.stripe_current_period_end, m.ends_at),
               p.name
          into v_membership_status, v_cancel_at_period_end, v_membership_end, v_plan_name
        from public.customer_memberships m
        left join public.customer_membership_plans p on p.id = m.plan_id
        where m.user_id = p_user_id
        order by m.updated_at desc
        limit 1;

        if v_membership_status in ('active','trialing') then
          if v_cancel_at_period_end and v_membership_end is not null then
            v_tier := 'Actif jusqu’au ' || to_char(v_membership_end at time zone 'Europe/Zurich', 'DD.MM.YYYY');
          else
            v_tier := coalesce(nullif(v_plan_name, ''), 'Client Chargeurs');
          end if;
        else
          v_tier := 'Pass inactif';
        end if;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'fields', jsonb_build_object('points', v_points, 'tier', left(coalesce(v_tier, 'Client Chargeurs'), 80)),
    'points', v_points,
    'tier', left(coalesce(v_tier, 'Client Chargeurs'), 80),
    'rentalSessionId', v_rental.id
  );
end;
$$;

create or replace function public.customer_wallet_realtime_rental_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.customer_user_id is null then return new; end if;

  if old.ejected_at is null and new.ejected_at is not null then
    perform public.enqueue_customer_wallet_sync_event(
      new.customer_user_id, 'rental_started', 'wallet:rental:' || new.id || ':started', new.id,
      jsonb_build_object('stationId', new.station_id), now() + interval '2 hours'
    );
  end if;

  if old.returned_at is null and new.returned_at is not null then
    perform public.enqueue_customer_wallet_sync_event(
      new.customer_user_id, 'return_detected', 'wallet:rental:' || new.id || ':returned', new.id,
      jsonb_build_object('returnStationId', new.return_station_id), now() + interval '2 hours'
    );
  end if;

  if old.settlement_status is distinct from new.settlement_status and new.settlement_status = 'settled' then
    perform public.enqueue_customer_wallet_sync_event(
      new.customer_user_id, 'rental_settled', 'wallet:rental:' || new.id || ':settled', new.id,
      jsonb_build_object('finalAmountCents', new.final_amount_cents, 'currency', new.currency), now() + interval '24 hours'
    );
  end if;

  if ((old.state is distinct from new.state and new.state in ('payment_failed','needs_support'))
      or (old.settlement_status is distinct from new.settlement_status and new.settlement_status in ('failed','manual_review'))) then
    perform public.enqueue_customer_wallet_sync_event(
      new.customer_user_id, 'rental_issue',
      'wallet:rental:' || new.id || ':issue:' || coalesce(new.state,'') || ':' || coalesce(new.settlement_status,''),
      new.id, jsonb_build_object('state', new.state, 'settlementStatus', new.settlement_status), now() + interval '2 hours'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists customer_wallet_realtime_rental_events_trg on public.rental_sessions;
create trigger customer_wallet_realtime_rental_events_trg
after update on public.rental_sessions
for each row execute function public.customer_wallet_realtime_rental_events();

create or replace function public.customer_wallet_chargepoints_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_push_id uuid;
  v_title text;
  v_body text;
begin
  perform public.enqueue_customer_wallet_sync_event(
    new.user_id,
    'chargepoints_changed',
    'wallet:chargepoints:' || new.id,
    case when new.source_type = 'rental' and coalesce(new.source_id, '') ~ '^[0-9a-fA-F-]{36}$' then new.source_id::uuid else null end,
    jsonb_build_object('delta', new.delta, 'reason', new.reason, 'sourceType', new.source_type),
    now() + interval '24 hours'
  );

  if new.source_type <> 'rental' and new.delta > 0 then
    v_title := 'ChargePoints ajoutés';
    v_body := '+' || new.delta || ' ChargePoints ont été ajoutés à votre Pass Chargeurs+.';
    v_push_id := public.queue_customer_push_notification(
      new.user_id, 'chargepoints_bonus', v_title, v_body, '/compte/pass',
      'push:chargepoints:' || new.id,
      jsonb_build_object('delta', new.delta, 'reason', new.reason)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists customer_wallet_chargepoints_events_trg on public.customer_chargepoints_ledger;
create trigger customer_wallet_chargepoints_events_trg
after insert on public.customer_chargepoints_ledger
for each row execute function public.customer_wallet_chargepoints_events();

create or replace function public.customer_wallet_membership_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status is distinct from new.status
     or old.cancel_at_period_end is distinct from new.cancel_at_period_end
     or old.renews_at is distinct from new.renews_at
     or old.ends_at is distinct from new.ends_at
     or old.stripe_current_period_end is distinct from new.stripe_current_period_end then
    perform public.enqueue_customer_wallet_sync_event(
      new.user_id,
      'membership_changed',
      'wallet:membership:' || new.id || ':' || md5(concat_ws(':', new.status, new.cancel_at_period_end::text, coalesce(new.renews_at::text,''), coalesce(new.ends_at::text,''), coalesce(new.stripe_current_period_end::text,''))),
      null,
      jsonb_build_object('membershipId', new.id, 'status', new.status, 'cancelAtPeriodEnd', new.cancel_at_period_end),
      now() + interval '24 hours'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists customer_wallet_membership_events_trg on public.customer_memberships;
create trigger customer_wallet_membership_events_trg
after update on public.customer_memberships
for each row execute function public.customer_wallet_membership_events();

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
  select coalesce((value->>'enabled')::boolean, false),
         coalesce(nullif(value->>'enabled_from','')::timestamptz, now())
    into v_enabled, v_enabled_from
  from public.app_settings
  where key = 'customer_wallet.realtime';

  if not coalesce(v_enabled, false) then return 0; end if;

  for r in
    select rs.*
    from public.rental_sessions rs
    where rs.customer_user_id is not null
      and coalesce(rs.started_at, rs.ejected_at) is not null
      and coalesce(rs.started_at, rs.ejected_at) >= v_enabled_from
      and rs.returned_at is null
      and rs.state not in ('completed','cancelled','payment_failed','expired')
      and exists (
        select 1 from public.customer_wallet_passes wp
        where wp.user_id = rs.customer_user_id
          and wp.status = 'active'
          and wp.revoked_at is null
          and wp.provider = 'pass_studio'
          and wp.provider_instance_id is not null
      )
  loop
    v_pricing := public.customer_wallet_pricing_state(r.pricing_snapshot, coalesce(r.started_at, r.ejected_at), now());
    if v_pricing is null then continue; end if;
    v_amount := coalesce(nullif(v_pricing->>'final_cents','')::integer, 0);
    v_initial := coalesce(nullif(r.pricing_snapshot->>'final_cents','')::integer, v_amount);
    if v_amount = v_initial then continue; end if;

    v_currency := upper(coalesce(nullif(v_pricing->>'currency',''), nullif(r.currency,''), 'CHF'));
    v_cap := coalesce((v_pricing->>'cap_reached')::boolean, false);
    v_event_id := public.enqueue_customer_wallet_sync_event(
      r.customer_user_id,
      case when v_cap then 'daily_cap_reached' else 'price_stage_changed' end,
      'wallet:rental:' || r.id || ':price:' || v_amount,
      r.id,
      jsonb_build_object('currentAmountCents', v_amount, 'currency', v_currency, 'capReached', v_cap, 'totalMinutes', v_pricing->>'total_minutes'),
      now() + interval '30 minutes'
    );

    if v_event_id is not null then
      v_count := v_count + 1;
      v_lang := case when r.customer_language in ('de','en') then r.customer_language else 'fr' end;
      v_amount_text := v_currency || ' ' || to_char(v_amount::numeric / 100, 'FM999999990.00');
      if v_cap then
        v_title := case v_lang when 'de' then 'Tageslimit erreicht' when 'en' then 'Daily cap reached' else 'Plafond journalier atteint' end;
        v_body := case v_lang when 'de' then 'Ihre aktuellen Mietkosten betragen ' || v_amount_text || '. Das Tageslimit ist erreicht.' when 'en' then 'Your current rental cost is ' || v_amount_text || '. The daily cap has been reached.' else 'Votre location est maintenant à ' || v_amount_text || '. Le plafond journalier est atteint.' end;
      else
        v_title := case v_lang when 'de' then 'Mietpreis aktualisiert' when 'en' then 'Rental price updated' else 'Tarif de location mis à jour' end;
        v_body := case v_lang when 'de' then 'Ihre Miete kostet jetzt ' || v_amount_text || '.' when 'en' then 'Your rental now costs ' || v_amount_text || '.' else 'Votre location est maintenant à ' || v_amount_text || '.' end;
      end if;
      perform public.queue_customer_push_notification(
        r.customer_user_id,
        case when v_cap then 'daily_cap_reached' else 'price_stage_changed' end,
        v_title, v_body, '/compte/pass',
        'push:rental:' || r.id || ':price:' || v_amount,
        jsonb_build_object('rentalSessionId', r.id, 'currentAmountCents', v_amount, 'currency', v_currency, 'capReached', v_cap)
      );
    end if;
  end loop;

  return v_count;
end;
$$;

-- Existing customer push lifecycle stays canonical; only enrich the start/final messages with backend amounts.
create or replace function public.customer_push_rental_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  l text := case when new.customer_language in ('de','en') then new.customer_language else 'fr' end;
  title_text text;
  body_text text;
  amount_text text;
  amount_cents bigint;
begin
  if new.customer_user_id is null then return new; end if;

  if old.paid_at is null and new.paid_at is not null then
    title_text := case l when 'de' then 'Zahlung bestätigt' when 'en' then 'Payment confirmed' else 'Paiement confirmé' end;
    body_text := case l when 'de' then 'Ihre Mietgarantie wurde bestätigt. Die Powerbank wird erst nach bestätigter physischer Ausgabe als vermietet markiert.' when 'en' then 'Your rental guarantee is confirmed. The rental starts only after physical release is confirmed.' else 'Votre garantie de location est confirmée. La location démarre uniquement après confirmation de la sortie physique.' end;
    perform public.queue_customer_push_notification(new.customer_user_id,'payment_secured',title_text,body_text,'/compte/paiements','push:rental:'||new.id||':payment_secured',jsonb_build_object('rentalSessionId',new.id,'stationId',new.station_id));
  end if;

  if old.ejected_at is null and new.ejected_at is not null then
    amount_cents := case when coalesce(new.pricing_snapshot->>'final_cents','') ~ '^[0-9]+$' then (new.pricing_snapshot->>'final_cents')::bigint else null end;
    amount_text := case when amount_cents is null then null else upper(coalesce(nullif(new.currency,''),'CHF')) || ' ' || to_char(amount_cents::numeric / 100, 'FM999999990.00') end;
    title_text := case l when 'de' then 'Ihre Powerbank ist ausgegeben' when 'en' then 'Your powerbank is out' else 'Votre batterie est sortie' end;
    body_text := case l
      when 'de' then 'Die physische Ausgabe wurde bestätigt. Ihre Miete läuft jetzt.' || case when amount_text is null then '' else ' Aktuelle Kosten: ' || amount_text || '.' end
      when 'en' then 'Physical release is confirmed. Your rental is now active.' || case when amount_text is null then '' else ' Current cost: ' || amount_text || '.' end
      else 'La sortie physique est confirmée. Votre location est maintenant active.' || case when amount_text is null then '' else ' Coût actuel : ' || amount_text || '.' end
    end;
    perform public.queue_customer_push_notification(new.customer_user_id,'rental_started',title_text,body_text,'/compte/locations','push:rental:'||new.id||':started',jsonb_build_object('rentalSessionId',new.id,'stationId',new.station_id,'batteryId',new.battery_id,'currentAmountCents',amount_cents,'currency',new.currency));
  end if;

  if old.returned_at is null and new.returned_at is not null then
    title_text := case l when 'de' then 'Rückgabe erkannt' when 'en' then 'Return detected' else 'Retour détecté' end;
    body_text := case l when 'de' then 'Ihre Powerbank wurde erkannt. Der Endbetrag wird jetzt berechnet.' when 'en' then 'Your powerbank was detected. The final amount is now being calculated.' else 'Votre batterie a été reconnue. Le montant final est maintenant calculé.' end;
    perform public.queue_customer_push_notification(new.customer_user_id,'return_detected',title_text,body_text,'/compte/locations','push:rental:'||new.id||':returned',jsonb_build_object('rentalSessionId',new.id,'returnStationId',new.return_station_id));
  end if;

  if old.settlement_status is distinct from new.settlement_status and new.settlement_status='settled' then
    amount_cents := coalesce(new.final_amount_cents, new.captured_amount_cents, 0);
    amount_text := upper(coalesce(nullif(new.currency,''),'CHF')) || ' ' || to_char(amount_cents::numeric / 100, 'FM999999990.00');
    title_text := case l when 'de' then 'Miete abgeschlossen' when 'en' then 'Rental completed' else 'Location terminée' end;
    body_text := case l when 'de' then 'Ihre Miete ist abgeschlossen. Endbetrag: ' || amount_text || '.' when 'en' then 'Your rental is complete. Final amount: ' || amount_text || '.' else 'Votre location est terminée. Montant final : ' || amount_text || '.' end;
    perform public.queue_customer_push_notification(new.customer_user_id,'rental_completed',title_text,body_text,'/compte/paiements','push:rental:'||new.id||':settled',jsonb_build_object('rentalSessionId',new.id,'finalAmountCents',new.final_amount_cents,'capturedAmountCents',new.captured_amount_cents,'currency',new.currency));
  end if;

  if ((old.state is distinct from new.state and new.state in ('payment_failed','needs_support')) or (old.settlement_status is distinct from new.settlement_status and new.settlement_status in ('failed','manual_review'))) then
    title_text := case l when 'de' then 'Aktion erforderlich' when 'en' then 'Action required' else 'Action requise' end;
    body_text := case l when 'de' then 'Ihre Miete benötigt eine sichere Überprüfung. Öffnen Sie Chargeurs+ für den aktuellen Status.' when 'en' then 'Your rental needs a secure review. Open Chargeurs+ for the current status.' else 'Votre location nécessite une vérification sécurisée. Ouvrez Chargeurs+ pour consulter l’état actuel.' end;
    perform public.queue_customer_push_notification(new.customer_user_id,'rental_issue',title_text,body_text,'/support','push:rental:'||new.id||':issue:'||new.state||':'||new.settlement_status,jsonb_build_object('rentalSessionId',new.id,'state',new.state,'settlementStatus',new.settlement_status));
  end if;
  return new;
end;
$$;

-- pg_cron 1.6 supports second-based intervals. This only materializes due events; it never calls Pass Studio.
do $$
begin
  perform cron.unschedule('chargeurs-wallet-price-transitions');
exception when others then null;
end $$;
select cron.schedule(
  'chargeurs-wallet-price-transitions',
  '10 seconds',
  'select public.queue_due_customer_wallet_price_transitions();'
);
