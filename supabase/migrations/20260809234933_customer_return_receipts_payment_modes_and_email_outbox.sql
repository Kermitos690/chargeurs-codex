alter table public.rental_sessions
  add column if not exists checkout_payment_mode text,
  add column if not exists contract_terms_version text,
  add column if not exists contract_privacy_version text,
  add column if not exists contract_accepted_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists payment_confirmation_email_sent_at timestamptz,
  add column if not exists rental_started_email_sent_at timestamptz,
  add column if not exists rental_receipt_email_sent_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rental_sessions_checkout_payment_mode_check') then
    alter table public.rental_sessions add constraint rental_sessions_checkout_payment_mode_check
      check (checkout_payment_mode is null or checkout_payment_mode in ('card_hold','twint_prepaid'));
  end if;
end $$;

create table if not exists public.kiosk_return_receipt_acknowledgements (
  rental_session_id uuid not null references public.rental_sessions(id) on delete cascade,
  kiosk_device_id text not null,
  acknowledged_at timestamptz not null default now(),
  primary key (rental_session_id, kiosk_device_id)
);
alter table public.kiosk_return_receipt_acknowledgements enable row level security;
revoke all on public.kiosk_return_receipt_acknowledgements from anon, authenticated;

create table if not exists public.transactional_email_outbox (
  id uuid primary key default gen_random_uuid(),
  rental_session_id uuid not null references public.rental_sessions(id) on delete cascade,
  template_key text not null check (template_key in ('payment_secured','rental_started','rental_completed')),
  to_email text not null,
  locale text not null default 'fr' check (locale in ('fr','de','en')),
  status text not null default 'queued' check (status in ('queued','sending','sent','failed')),
  attempts integer not null default 0,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rental_session_id, template_key)
);
create index if not exists transactional_email_outbox_queue_idx on public.transactional_email_outbox(status, created_at);
alter table public.transactional_email_outbox enable row level security;
revoke all on public.transactional_email_outbox from anon, authenticated;

create or replace function public.enqueue_rental_transactional_emails()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_locale text := case when new.customer_language in ('fr','de','en') then new.customer_language else 'fr' end;
begin
  if new.customer_email is null or btrim(new.customer_email) = '' then return new; end if;
  if new.paid_at is not null and (old.paid_at is null or old.customer_email is distinct from new.customer_email) then
    insert into public.transactional_email_outbox(rental_session_id, template_key, to_email, locale)
    values (new.id, 'payment_secured', new.customer_email, v_locale)
    on conflict (rental_session_id, template_key) do nothing;
  end if;
  if new.started_at is not null and (old.started_at is null or old.customer_email is distinct from new.customer_email) then
    insert into public.transactional_email_outbox(rental_session_id, template_key, to_email, locale)
    values (new.id, 'rental_started', new.customer_email, v_locale)
    on conflict (rental_session_id, template_key) do nothing;
  end if;
  if new.state = 'completed' and old.state is distinct from new.state then
    insert into public.transactional_email_outbox(rental_session_id, template_key, to_email, locale)
    values (new.id, 'rental_completed', new.customer_email, v_locale)
    on conflict (rental_session_id, template_key) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists trg_enqueue_rental_transactional_emails on public.rental_sessions;
create trigger trg_enqueue_rental_transactional_emails after update on public.rental_sessions
for each row execute function public.enqueue_rental_transactional_emails();

create or replace function public.normalize_completed_rental_projection()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.state = 'completed' then new.completed_at := coalesce(new.completed_at, new.closed_at, new.settled_at, now()); end if;
  return new;
end $$;
drop trigger if exists trg_normalize_completed_rental_projection on public.rental_sessions;
create trigger trg_normalize_completed_rental_projection before insert or update on public.rental_sessions
for each row execute function public.normalize_completed_rental_projection();

create or replace function public.kiosk_session_status(p_id uuid, p_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'state', rs.state,
    'state_version', rs.state_version,
    'updated_at', rs.updated_at,
    'selected_slot_num', rs.selected_slot_num,
    'checkout_url', rs.checkout_url,
    'public_session_code', rs.public_session_code,
    'checkout_url_expires_at', rs.checkout_url_expires_at,
    'failure_code', rs.failure_code,
    'failure_message', rs.failure_message,
    'currency', rs.currency,
    'customer_language', rs.customer_language,
    'checkout_payment_mode', rs.checkout_payment_mode,
    'settlement_strategy', rs.settlement_strategy,
    'settlement_status', rs.settlement_status,
    'stripe_payment_method_type', rs.stripe_payment_method_type,
    'deposit_amount_cents', rs.deposit_amount_cents,
    'final_amount_cents', rs.final_amount_cents,
    'captured_amount_cents', rs.captured_amount_cents,
    'refunded_amount_cents', rs.refunded_amount_cents,
    'supplemental_amount_cents', rs.supplemental_amount_cents,
    'started_at', rs.started_at,
    'returned_at', rs.returned_at,
    'completed_at', rs.completed_at,
    'return_station_id', rs.return_station_id,
    'returned_slot_num', rs.returned_slot_num,
    'pricing', case when rs.pricing_snapshot is null then null else jsonb_build_object(
      'profile_name', rs.pricing_snapshot->>'profile_name',
      'period_minutes', nullif(rs.pricing_snapshot->>'period_minutes','')::integer,
      'price_per_period_cents', nullif(rs.pricing_snapshot->>'price_per_period_cents','')::integer,
      'daily_cap_cents', nullif(rs.pricing_snapshot->>'daily_cap_cents','')::integer,
      'unreturned_fee_cents', nullif(rs.pricing_snapshot->>'unreturned_fee_cents','')::integer,
      'deposit_cents', nullif(rs.pricing_snapshot->>'deposit_cents','')::integer
    ) end
  )
  from public.rental_sessions rs
  where rs.id = p_id and rs.public_session_code is not null and p_code is not null
    and length(p_code) >= 4 and rs.public_session_code = p_code
$$;
grant execute on function public.kiosk_session_status(uuid,text) to anon, authenticated;
