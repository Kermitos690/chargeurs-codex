-- Chargeurs Express Wallet V1
-- Isolated from payment/ejection/settlement. Provider failures must never block a rental.

create table if not exists public.guest_wallet_passes (
  id uuid primary key default gen_random_uuid(),
  email_hash text not null unique,
  status text not null default 'active' check (status in ('active','revoked')),
  provider text not null default 'pass_studio',
  provider_status text not null default 'not_issued',
  provider_pass_id text,
  provider_instance_id text,
  provider_holder_id text,
  provider_barcode_content text,
  provider_add_to_wallet_url text,
  provider_last_error_code text,
  current_rental_id uuid references public.rental_sessions(id) on delete set null,
  pass_revision integer not null default 0,
  last_synced_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists guest_wallet_passes_provider_instance_uidx
  on public.guest_wallet_passes(provider_instance_id)
  where provider_instance_id is not null;

create table if not exists public.guest_wallet_rental_links (
  rental_id uuid primary key references public.rental_sessions(id) on delete cascade,
  guest_wallet_pass_id uuid not null references public.guest_wallet_passes(id) on delete cascade,
  linked_at timestamptz not null default now()
);
create index if not exists guest_wallet_rental_links_pass_idx
  on public.guest_wallet_rental_links(guest_wallet_pass_id, linked_at desc);

create table if not exists public.guest_wallet_outbox (
  id uuid primary key default gen_random_uuid(),
  guest_wallet_pass_id uuid not null references public.guest_wallet_passes(id) on delete cascade,
  rental_id uuid not null references public.rental_sessions(id) on delete cascade,
  event_type text not null,
  event_key text not null unique,
  message text,
  status text not null default 'pending' check (status in ('pending','processing','delivered','failed','expired')),
  metadata jsonb not null default '{}'::jsonb,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  expires_at timestamptz,
  delivered_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists guest_wallet_outbox_due_idx
  on public.guest_wallet_outbox(status, next_attempt_at, created_at);

alter table public.guest_wallet_passes enable row level security;
alter table public.guest_wallet_rental_links enable row level security;
alter table public.guest_wallet_outbox enable row level security;

revoke all on public.guest_wallet_passes from anon, authenticated;
revoke all on public.guest_wallet_rental_links from anon, authenticated;
revoke all on public.guest_wallet_outbox from anon, authenticated;
grant all on public.guest_wallet_passes to service_role;
grant all on public.guest_wallet_rental_links to service_role;
grant all on public.guest_wallet_outbox to service_role;

insert into public.app_settings(key, value, updated_at)
values (
  'guest_wallet.express',
  jsonb_build_object(
    'enabled', false,
    'passName', 'Chargeurs Express',
    'version', 1,
    'note', 'Enable only after the dedicated Pass Studio template is active.'
  ),
  now()
)
on conflict (key) do nothing;

create or replace function public.guest_wallet_presentation_state(p_rental_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r public.rental_sessions%rowtype;
  pricing jsonb;
  amount_cents integer := 0;
  currency_code text := 'CHF';
  status_text text := 'Préparation';
  price_text text := 'CHF 0.00';
  started_text text := null;
begin
  select * into r from public.rental_sessions where id = p_rental_id;
  if r.id is null then raise exception 'GUEST_WALLET_RENTAL_NOT_FOUND'; end if;

  currency_code := upper(coalesce(nullif(r.currency, ''), 'CHF'));

  if r.state in ('needs_support','manual_review') or r.settlement_status in ('failed','manual_review') then
    status_text := case coalesce(r.customer_language,'fr') when 'de' then 'Aktion erforderlich' when 'en' then 'Action required' else 'Action requise' end;
  elsif r.settlement_status = 'settled' then
    amount_cents := coalesce(r.final_amount_cents, r.captured_amount_cents, 0)::integer;
    price_text := currency_code || ' ' || to_char(amount_cents::numeric / 100, 'FM999999990.00');
    status_text := case coalesce(r.customer_language,'fr') when 'de' then 'Beendet · ' when 'en' then 'Completed · ' else 'Terminé · ' end || price_text;
  elsif r.returned_at is not null or r.state = 'battery_returned' then
    status_text := case coalesce(r.customer_language,'fr') when 'de' then 'Rückgabe erkannt' when 'en' then 'Return detected' else 'Retour détecté' end;
  elsif r.cancelled_at is not null or r.state = 'cancelled' then
    status_text := case coalesce(r.customer_language,'fr') when 'de' then 'Miete storniert' when 'en' then 'Rental cancelled' else 'Location annulée' end;
  elsif coalesce(r.started_at, r.ejected_at) is not null then
    pricing := public.customer_wallet_pricing_state(r.pricing_snapshot, coalesce(r.started_at, r.ejected_at), now());
    amount_cents := coalesce(nullif(pricing->>'final_cents','')::integer, nullif(r.pricing_snapshot->>'final_cents','')::integer, 0);
    currency_code := upper(coalesce(nullif(pricing->>'currency',''), nullif(r.currency,''), 'CHF'));
    price_text := currency_code || ' ' || to_char(amount_cents::numeric / 100, 'FM999999990.00');
    if coalesce((pricing->>'cap_reached')::boolean, false) then
      status_text := case coalesce(r.customer_language,'fr') when 'de' then 'Limit erreicht · ' when 'en' then 'Cap reached · ' else 'Plafond atteint · ' end || price_text;
    else
      status_text := case coalesce(r.customer_language,'fr') when 'de' then 'Miete · ' when 'en' then 'Rental · ' else 'Location · ' end || price_text;
    end if;
  else
    status_text := case coalesce(r.customer_language,'fr') when 'de' then 'Vorbereitung' when 'en' then 'Preparing' else 'Préparation' end;
  end if;

  if coalesce(r.started_at, r.ejected_at) is not null then
    started_text := to_char(coalesce(r.started_at, r.ejected_at) at time zone 'Europe/Zurich', 'DD.MM.YYYY HH24:MI');
  end if;

  return jsonb_build_object(
    'fields', jsonb_build_object(
      'status', left(status_text, 80),
      'tier', left(status_text, 80),
      'current_price', price_text,
      'price', price_text,
      'rental_reference', coalesce(r.public_session_code, ''),
      'reference', coalesce(r.public_session_code, ''),
      'station', coalesce(r.station_id, ''),
      'started_at', started_text
    ),
    'rentalSessionId', r.id,
    'status', left(status_text, 80),
    'currentPrice', price_text
  );
end;
$$;

revoke all on function public.guest_wallet_presentation_state(uuid) from public, anon, authenticated;
grant execute on function public.guest_wallet_presentation_state(uuid) to service_role;

create or replace function public.enqueue_guest_wallet_event(
  p_rental_id uuid,
  p_event_type text,
  p_event_key text,
  p_message text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_expires_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  wallet_id uuid;
  inserted_id uuid;
begin
  select l.guest_wallet_pass_id into wallet_id
  from public.guest_wallet_rental_links l
  join public.guest_wallet_passes w on w.id = l.guest_wallet_pass_id
  where l.rental_id = p_rental_id
    and w.status = 'active'
    and w.provider = 'pass_studio'
    and w.provider_instance_id is not null
    and w.revoked_at is null;

  if wallet_id is null then return null; end if;

  insert into public.guest_wallet_outbox(
    guest_wallet_pass_id, rental_id, event_type, event_key, message, metadata, expires_at
  ) values (
    wallet_id, p_rental_id, p_event_type, p_event_key, nullif(left(coalesce(p_message,''), 240), ''), coalesce(p_metadata,'{}'::jsonb), p_expires_at
  )
  on conflict (event_key) do nothing
  returning id into inserted_id;

  return inserted_id;
end;
$$;
revoke all on function public.enqueue_guest_wallet_event(uuid,text,text,text,jsonb,timestamptz) from public, anon, authenticated;
grant execute on function public.enqueue_guest_wallet_event(uuid,text,text,text,jsonb,timestamptz) to service_role;

create or replace function public.auto_link_guest_wallet_from_rental_email()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  wallet_id uuid;
  email_digest text;
begin
  if new.customer_segment <> 'guest' or nullif(trim(new.customer_email),'') is null then return new; end if;
  if tg_op = 'UPDATE' and old.customer_email is not distinct from new.customer_email then return new; end if;

  email_digest := encode(extensions.digest(lower(trim(new.customer_email)), 'sha256'), 'hex');
  select id into wallet_id
  from public.guest_wallet_passes
  where email_hash = email_digest and status = 'active' and revoked_at is null
  order by updated_at desc limit 1;

  if wallet_id is not null then
    insert into public.guest_wallet_rental_links(rental_id, guest_wallet_pass_id)
    values (new.id, wallet_id)
    on conflict (rental_id) do nothing;
    update public.guest_wallet_passes set current_rental_id = new.id, updated_at = now() where id = wallet_id;
    perform public.enqueue_guest_wallet_event(
      new.id, 'rental_attached', 'guest-wallet:rental:' || new.id || ':attached', null,
      jsonb_build_object('source','email_reuse'), now() + interval '2 hours'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_auto_link_guest_wallet_from_rental_email on public.rental_sessions;
create trigger trg_auto_link_guest_wallet_from_rental_email
after insert or update of customer_email on public.rental_sessions
for each row execute function public.auto_link_guest_wallet_from_rental_email();

create or replace function public.queue_guest_wallet_rental_state_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  lang text := case when new.customer_language in ('de','en') then new.customer_language else 'fr' end;
  pricing jsonb;
  amount_cents integer;
  currency_code text;
  amount_text text;
  msg text;
begin
  if new.customer_segment <> 'guest' then return new; end if;
  if not exists (select 1 from public.guest_wallet_rental_links where rental_id = new.id) then return new; end if;

  if coalesce(old.started_at, old.ejected_at) is null and coalesce(new.started_at, new.ejected_at) is not null then
    pricing := public.customer_wallet_pricing_state(new.pricing_snapshot, coalesce(new.started_at,new.ejected_at), now());
    amount_cents := coalesce(nullif(pricing->>'final_cents','')::integer, nullif(new.pricing_snapshot->>'final_cents','')::integer, 0);
    currency_code := upper(coalesce(nullif(pricing->>'currency',''), nullif(new.currency,''), 'CHF'));
    amount_text := currency_code || ' ' || to_char(amount_cents::numeric / 100, 'FM999999990.00');
    msg := case lang when 'de' then 'Ihre Miete hat begonnen · ' || amount_text when 'en' then 'Your rental has started · ' || amount_text else 'Votre location a démarré · ' || amount_text end;
    perform public.enqueue_guest_wallet_event(new.id, 'rental_started', 'guest-wallet:rental:'||new.id||':started', msg, jsonb_build_object('currentAmountCents',amount_cents,'currency',currency_code), now()+interval '2 hours');
  end if;

  if old.returned_at is null and new.returned_at is not null then
    msg := case lang when 'de' then 'Powerbank zurückgegeben. Abschluss läuft.' when 'en' then 'Powerbank returned. Finalising your rental.' else 'Batterie retournée. Finalisation de votre location en cours.' end;
    perform public.enqueue_guest_wallet_event(new.id, 'return_detected', 'guest-wallet:rental:'||new.id||':returned', msg, '{}'::jsonb, now()+interval '2 hours');
  end if;

  if coalesce(old.settlement_status,'') <> 'settled' and new.settlement_status = 'settled' then
    amount_cents := coalesce(new.final_amount_cents, new.captured_amount_cents, 0)::integer;
    currency_code := upper(coalesce(nullif(new.currency,''), 'CHF'));
    amount_text := currency_code || ' ' || to_char(amount_cents::numeric / 100, 'FM999999990.00');
    msg := case lang when 'de' then 'Miete beendet · ' || amount_text when 'en' then 'Rental completed · ' || amount_text else 'Location terminée · ' || amount_text end;
    perform public.enqueue_guest_wallet_event(new.id, 'settlement_completed', 'guest-wallet:rental:'||new.id||':settled', msg, jsonb_build_object('finalAmountCents',amount_cents,'currency',currency_code), now()+interval '24 hours');
  end if;

  if coalesce(old.state,'') <> 'needs_support' and new.state = 'needs_support' then
    msg := case lang when 'de' then 'Ihre Miete muss überprüft werden.' when 'en' then 'Your rental requires review.' else 'Votre location nécessite une vérification.' end;
    perform public.enqueue_guest_wallet_event(new.id, 'rental_issue', 'guest-wallet:rental:'||new.id||':needs-support', msg, '{}'::jsonb, now()+interval '4 hours');
  end if;

  if coalesce(old.state,'') <> 'cancelled' and new.state = 'cancelled' then
    msg := case lang when 'de' then 'Ihre Miete wurde storniert.' when 'en' then 'Your rental was cancelled.' else 'Votre location a été annulée.' end;
    perform public.enqueue_guest_wallet_event(new.id, 'rental_cancelled', 'guest-wallet:rental:'||new.id||':cancelled', msg, '{}'::jsonb, now()+interval '2 hours');
  end if;

  return new;
end;
$$;

drop trigger if exists trg_queue_guest_wallet_rental_state_event on public.rental_sessions;
create trigger trg_queue_guest_wallet_rental_state_event
after update of state, started_at, ejected_at, returned_at, settlement_status, final_amount_cents, captured_amount_cents
on public.rental_sessions
for each row execute function public.queue_guest_wallet_rental_state_event();

create or replace function public.queue_due_guest_wallet_price_transitions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  pricing jsonb;
  amount_cents integer;
  initial_cents integer;
  currency_code text;
  cap_reached boolean;
  lang text;
  amount_text text;
  msg text;
  event_id uuid;
  queued integer := 0;
  enabled boolean := false;
begin
  select coalesce((value->>'enabled')::boolean, false) into enabled
  from public.app_settings where key = 'guest_wallet.express';
  if not coalesce(enabled,false) then return 0; end if;

  for r in
    select rs.*
    from public.rental_sessions rs
    join public.guest_wallet_rental_links l on l.rental_id = rs.id
    join public.guest_wallet_passes w on w.id = l.guest_wallet_pass_id
    where rs.customer_segment = 'guest'
      and coalesce(rs.started_at,rs.ejected_at) is not null
      and rs.returned_at is null
      and rs.state not in ('completed','cancelled','payment_failed','expired')
      and w.status = 'active' and w.provider_instance_id is not null and w.revoked_at is null
  loop
    pricing := public.customer_wallet_pricing_state(r.pricing_snapshot, coalesce(r.started_at,r.ejected_at), now());
    if pricing is null then continue; end if;
    amount_cents := coalesce(nullif(pricing->>'final_cents','')::integer,0);
    initial_cents := coalesce(nullif(r.pricing_snapshot->>'final_cents','')::integer,amount_cents);
    if amount_cents = initial_cents then continue; end if;
    currency_code := upper(coalesce(nullif(pricing->>'currency',''),nullif(r.currency,''),'CHF'));
    cap_reached := coalesce((pricing->>'cap_reached')::boolean,false);
    amount_text := currency_code || ' ' || to_char(amount_cents::numeric / 100, 'FM999999990.00');
    lang := case when r.customer_language in ('de','en') then r.customer_language else 'fr' end;
    if cap_reached then
      msg := case lang when 'de' then 'Tageslimit erreicht · '||amount_text when 'en' then 'Daily cap reached · '||amount_text else 'Plafond journalier atteint · '||amount_text end;
    else
      msg := case lang when 'de' then 'Ihre Miete kostet jetzt '||amount_text when 'en' then 'Your rental now costs '||amount_text else 'Votre location est maintenant à '||amount_text end;
    end if;
    event_id := public.enqueue_guest_wallet_event(
      r.id,
      case when cap_reached then 'daily_cap_reached' else 'price_stage_changed' end,
      'guest-wallet:rental:'||r.id||':price:'||amount_cents,
      msg,
      jsonb_build_object('currentAmountCents',amount_cents,'currency',currency_code,'capReached',cap_reached),
      now()+interval '30 minutes'
    );
    if event_id is not null then queued := queued + 1; end if;
  end loop;
  return queued;
end;
$$;
revoke all on function public.queue_due_guest_wallet_price_transitions() from public, anon, authenticated;
grant execute on function public.queue_due_guest_wallet_price_transitions() to service_role;

-- Run alongside the existing member-wallet scanner. Recreate by name for idempotency.
do $$
declare job record;
begin
  for job in select jobid from cron.job where jobname = 'guest-wallet-price-transitions' loop
    perform cron.unschedule(job.jobid);
  end loop;
  perform cron.schedule('guest-wallet-price-transitions', '10 seconds', 'select public.queue_due_guest_wallet_price_transitions();');
end $$;
