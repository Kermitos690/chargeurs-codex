create table if not exists public.membership_email_outbox (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.customer_memberships(id) on delete cascade,
  template_key text not null check (template_key in ('membership_activated','membership_renewed','membership_payment_failed','membership_cancellation_scheduled','membership_renewal_resumed','membership_cancelled')),
  idempotency_key text not null unique,
  to_email text not null,
  locale text not null default 'fr' check (locale in ('fr','de','en')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued','sending','sent','failed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists membership_email_outbox_queue_idx
  on public.membership_email_outbox(status, next_attempt_at, created_at);

alter table public.membership_email_outbox enable row level security;
revoke all on public.membership_email_outbox from anon, authenticated;
