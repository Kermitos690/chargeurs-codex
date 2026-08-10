alter table public.customer_memberships
  add column if not exists stripe_checkout_session_id text,
  add column if not exists stripe_current_period_start timestamptz,
  add column if not exists stripe_current_period_end timestamptz,
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists last_stripe_event_id text;

create unique index if not exists customer_memberships_stripe_checkout_uidx
  on public.customer_memberships(stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

create unique index if not exists customer_memberships_stripe_subscription_uidx
  on public.customer_memberships(stripe_subscription_id)
  where stripe_subscription_id is not null;

create index if not exists customer_memberships_user_status_idx
  on public.customer_memberships(user_id, status, updated_at desc);
