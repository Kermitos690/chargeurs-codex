-- Payment settlement strategy for Chargeurs.ch.
--
-- Cards can authorize the 30 CHF deposit and capture later. TWINT does not
-- support manual capture, so it prepays the deposit and receives a partial
-- refund after return. The migration is additive and keeps legacy rows valid.

alter table public.rental_sessions
  add column if not exists settlement_strategy text,
  add column if not exists deposit_amount_cents bigint,
  add column if not exists final_amount_cents bigint,
  add column if not exists captured_amount_cents bigint not null default 0,
  add column if not exists refunded_amount_cents bigint not null default 0,
  add column if not exists supplemental_amount_cents bigint not null default 0,
  add column if not exists settlement_status text not null default 'pending',
  add column if not exists settlement_attempts integer not null default 0,
  add column if not exists settlement_locked_at timestamptz,
  add column if not exists settled_at timestamptz,
  add column if not exists stripe_payment_method_id text,
  add column if not exists stripe_supplemental_payment_intent_id text,
  add column if not exists settlement_error text;

alter table public.payments
  add column if not exists capture_method text,
  add column if not exists settlement_strategy text,
  add column if not exists amount_authorized_cents bigint not null default 0,
  add column if not exists amount_captured_cents bigint not null default 0,
  add column if not exists amount_refunded_cents bigint not null default 0,
  add column if not exists stripe_payment_method_id text,
  add column if not exists stripe_customer_id text;

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
        'pending','authorized','prepaid','settling','settled',
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
end $$;

create index if not exists rental_sessions_settlement_pending_idx
  on public.rental_sessions(settlement_status, returned_at)
  where settlement_status in ('pending','authorized','prepaid','failed','supplemental_required');

create unique index if not exists rental_sessions_supplemental_payment_intent_uidx
  on public.rental_sessions(stripe_supplemental_payment_intent_id)
  where stripe_supplemental_payment_intent_id is not null;

comment on column public.rental_sessions.settlement_strategy is
  'manual_capture for eligible cards; prepaid_refund for TWINT and automatically captured methods.';
comment on column public.rental_sessions.deposit_amount_cents is
  'Initial deposit/authorization amount in integer cents; MVP target is 3000 CHF cents.';
comment on column public.rental_sessions.final_amount_cents is
  'Authoritative final price returned by compute_pricing at return or non-return.';
