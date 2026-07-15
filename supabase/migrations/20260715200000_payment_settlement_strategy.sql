-- Canonical payment settlement strategy for Chargeurs.ch.
--
-- Existing rentals are marked `legacy` and can never be claimed by the new
-- automatic settlement worker. New rentals default to `pending` only after the
-- migration has safely classified historical rows.

alter table public.rental_sessions
  add column if not exists settlement_strategy text,
  add column if not exists deposit_amount_cents bigint,
  add column if not exists final_amount_cents bigint,
  add column if not exists captured_amount_cents bigint not null default 0,
  add column if not exists refunded_amount_cents bigint not null default 0,
  add column if not exists supplemental_amount_cents bigint not null default 0,
  add column if not exists settlement_status text,
  add column if not exists settlement_attempts integer not null default 0,
  add column if not exists settlement_locked_at timestamptz,
  add column if not exists settled_at timestamptz,
  add column if not exists stripe_payment_method_id text,
  add column if not exists stripe_supplemental_payment_intent_id text,
  add column if not exists settlement_error text;

update public.rental_sessions
set settlement_status = 'legacy'
where settlement_status is null;

alter table public.rental_sessions
  alter column settlement_status set default 'pending',
  alter column settlement_status set not null;

alter table public.payments
  add column if not exists capture_method text,
  add column if not exists settlement_strategy text,
  add column if not exists amount_authorized_cents bigint not null default 0,
  add column if not exists amount_captured_cents bigint not null default 0,
  add column if not exists amount_refunded_cents bigint not null default 0,
  add column if not exists stripe_payment_method_id text,
  add column if not exists stripe_customer_id text;

-- Existing webhook rows were handled by the legacy webhook and must not be
-- replayed. New rows begin in `received` after the backfill.
alter table public.webhook_events
  add column if not exists processing_status text,
  add column if not exists processing_started_at timestamptz,
  add column if not exists processed_at timestamptz,
  add column if not exists processing_error text,
  add column if not exists attempt_count integer not null default 0;

update public.webhook_events
set processing_status = 'processed',
    processed_at = coalesce(processed_at, created_at)
where processing_status is null;

alter table public.webhook_events
  alter column processing_status set default 'received',
  alter column processing_status set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'rental_sessions_settlement_strategy_check'
  ) then
    alter table public.rental_sessions add constraint rental_sessions_settlement_strategy_check
      check (settlement_strategy is null or settlement_strategy in ('manual_capture','prepaid_refund'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'rental_sessions_settlement_status_check'
  ) then
    alter table public.rental_sessions add constraint rental_sessions_settlement_status_check
      check (settlement_status in (
        'legacy','pending','authorized','prepaid','settling','settled',
        'supplemental_required','supplemental_processing','failed','manual_review'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'rental_sessions_settlement_amounts_check'
  ) then
    alter table public.rental_sessions add constraint rental_sessions_settlement_amounts_check
      check (
        coalesce(deposit_amount_cents,0) >= 0 and
        coalesce(final_amount_cents,0) >= 0 and
        captured_amount_cents >= 0 and
        refunded_amount_cents >= 0 and
        supplemental_amount_cents >= 0 and
        settlement_attempts >= 0
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'payments_capture_method_check'
  ) then
    alter table public.payments add constraint payments_capture_method_check
      check (capture_method is null or capture_method in ('manual','automatic','automatic_async'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'payments_settlement_strategy_check'
  ) then
    alter table public.payments add constraint payments_settlement_strategy_check
      check (settlement_strategy is null or settlement_strategy in ('manual_capture','prepaid_refund'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'payments_settlement_amounts_check'
  ) then
    alter table public.payments add constraint payments_settlement_amounts_check
      check (
        amount_authorized_cents >= 0 and
        amount_captured_cents >= 0 and
        amount_refunded_cents >= 0
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'webhook_events_processing_status_check'
  ) then
    alter table public.webhook_events add constraint webhook_events_processing_status_check
      check (processing_status in ('received','processing','processed','failed','ignored'));
  end if;
end $$;

create index if not exists rental_sessions_settlement_pending_idx
  on public.rental_sessions(settlement_status, returned_at)
  where settlement_status in ('pending','authorized','prepaid','settling','failed','supplemental_required');

create unique index if not exists rental_sessions_supplemental_payment_intent_uidx
  on public.rental_sessions(stripe_supplemental_payment_intent_id)
  where stripe_supplemental_payment_intent_id is not null;

create index if not exists webhook_events_retry_idx
  on public.webhook_events(processing_status, processing_started_at)
  where processing_status in ('received','processing','failed');

create or replace function public.claim_rental_settlement(
  p_rental_id uuid,
  p_lock_ttl_minutes integer default 10
)
returns public.rental_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.rental_sessions;
begin
  if p_lock_ttl_minutes < 1 or p_lock_ttl_minutes > 120 then
    raise exception using errcode = '22023', message = 'INVALID_LOCK_TTL';
  end if;

  update public.rental_sessions
  set settlement_status = 'settling',
      settlement_locked_at = now(),
      settlement_attempts = settlement_attempts + 1
  where id = p_rental_id
    and settlement_status <> 'settled'
    and (
      settlement_locked_at is null
      or settlement_locked_at < now() - make_interval(mins => p_lock_ttl_minutes)
    )
    and settlement_status in (
      'pending','authorized','prepaid','settling','failed','supplemental_required'
    )
  returning * into v_session;

  return v_session;
end;
$$;

revoke all on function public.claim_rental_settlement(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_rental_settlement(uuid, integer) to service_role;

comment on column public.rental_sessions.settlement_status is
  'legacy rows are excluded from automated settlement; new rentals start pending.';
comment on column public.rental_sessions.settlement_strategy is
  'manual_capture for eligible cards; prepaid_refund for TWINT and automatically captured methods.';
comment on column public.rental_sessions.deposit_amount_cents is
  'Initial deposit or authorization amount in integer cents; MVP target is 3000 CHF cents.';
comment on column public.rental_sessions.final_amount_cents is
  'Authoritative final price returned by compute_pricing at return or non-return.';
comment on function public.claim_rental_settlement(uuid, integer) is
  'Atomically claims a non-legacy rental for final settlement with stale-lock recovery; service_role only.';
