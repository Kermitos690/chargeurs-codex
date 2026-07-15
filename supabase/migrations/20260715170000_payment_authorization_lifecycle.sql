-- Chargeurs.ch staged payment authorization lifecycle.
-- Adds explicit authorization/capture/finalization fields without activating the flow.

alter table public.rental_sessions
  add column if not exists payment_flow text not null default 'checkout_capture'
    check (payment_flow in ('checkout_capture', 'manual_authorization')),
  add column if not exists authorized_amount_cents integer not null default 0 check (authorized_amount_cents >= 0),
  add column if not exists captured_amount_cents integer not null default 0 check (captured_amount_cents >= 0),
  add column if not exists refunded_amount_cents integer not null default 0 check (refunded_amount_cents >= 0),
  add column if not exists final_amount_cents integer check (final_amount_cents is null or final_amount_cents >= 0),
  add column if not exists additional_amount_cents integer not null default 0 check (additional_amount_cents >= 0),
  add column if not exists authorization_expires_at timestamptz,
  add column if not exists payment_finalization_status text not null default 'not_started'
    check (payment_finalization_status in ('not_started','pending','captured','cancelled','refunded','additional_payment_required','failed','manual_review')),
  add column if not exists stripe_additional_payment_intent_id text,
  add column if not exists payment_finalized_at timestamptz;

create index if not exists rental_sessions_payment_finalization_idx
  on public.rental_sessions(payment_finalization_status, created_at desc);

create unique index if not exists rental_sessions_additional_pi_unique
  on public.rental_sessions(stripe_additional_payment_intent_id)
  where stripe_additional_payment_intent_id is not null;

create table if not exists public.payment_lifecycle_operations (
  id uuid primary key default gen_random_uuid(),
  rental_session_id uuid not null references public.rental_sessions(id) on delete cascade,
  operation_type text not null check (operation_type in ('authorize','capture','cancel_authorization','refund','additional_charge')),
  idempotency_key text not null,
  requested_amount_cents integer not null default 0 check (requested_amount_cents >= 0),
  provider_object_id text,
  status text not null default 'pending' check (status in ('pending','succeeded','failed','unknown')),
  error_code text,
  error_message text,
  response_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rental_session_id, operation_type, idempotency_key)
);

create index if not exists payment_lifecycle_operations_rental_idx
  on public.payment_lifecycle_operations(rental_session_id, created_at desc);

alter table public.payment_lifecycle_operations enable row level security;
revoke all on public.payment_lifecycle_operations from public, anon, authenticated;
grant all on public.payment_lifecycle_operations to service_role;

create or replace function public.touch_payment_lifecycle_operation()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_payment_lifecycle_operation on public.payment_lifecycle_operations;
create trigger trg_touch_payment_lifecycle_operation
before update on public.payment_lifecycle_operations
for each row execute function public.touch_payment_lifecycle_operation();

comment on column public.rental_sessions.payment_flow is 'checkout_capture is the legacy flow; manual_authorization is the staged 30 CHF authorization flow.';
comment on table public.payment_lifecycle_operations is 'Idempotent provider-side authorization, capture, cancellation, refund and supplemental charge operations.';
