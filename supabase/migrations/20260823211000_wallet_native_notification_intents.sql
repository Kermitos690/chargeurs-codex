-- Chargeurs+ native Wallet notification intents.
-- Pass Studio documents lock-screen Campaign/Journey notifications in Studio,
-- but its public REST API currently exposes no per-holder transactional notification endpoint.
-- Every customer-visible push alert is therefore mirrored into this provider-neutral outbox.
-- Delivery remains blocked/auditable until Pass Studio exposes the required capability.

create table if not exists public.customer_wallet_native_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_notification_id uuid null references public.notifications(id) on delete cascade,
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

create or replace function public.queue_customer_wallet_native_notification_from_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.channel <> 'push' or new.user_id is null then
    return new;
  end if;

  -- Native Wallet notifications are only meaningful for holders with an installed Pass Studio instance.
  if not exists (
    select 1
    from public.customer_wallet_passes wp
    where wp.user_id = new.user_id
      and wp.status = 'active'
      and wp.provider = 'pass_studio'
      and wp.provider_instance_id is not null
      and wp.revoked_at is null
  ) then
    return new;
  end if;

  insert into public.customer_wallet_native_notifications(
    user_id,
    source_notification_id,
    event_type,
    event_key,
    title,
    message,
    metadata,
    status,
    last_error_code
  ) values (
    new.user_id,
    new.id,
    left(new.type, 80),
    'native:push:' || new.id,
    left(new.title, 100),
    left(coalesce(new.body, new.title), 140),
    coalesce(new.data, '{}'::jsonb) || jsonb_build_object(
      'sourceChannel', 'push',
      'sourceNotificationId', new.id,
      'sourceIdempotencyKey', new.idempotency_key
    ),
    'provider_capability_blocked',
    'PASS_STUDIO_TRANSACTIONAL_NOTIFICATION_API_UNAVAILABLE'
  )
  on conflict (event_key) do nothing;

  return new;
end;
$$;

revoke all on function public.queue_customer_wallet_native_notification_from_push() from public, anon, authenticated;

drop trigger if exists customer_wallet_native_notification_mirror_trg on public.notifications;
create trigger customer_wallet_native_notification_mirror_trg
after insert on public.notifications
for each row execute function public.queue_customer_wallet_native_notification_from_push();

comment on table public.customer_wallet_native_notifications is
  'Per-holder native Wallet lock-screen notification intents. Current Pass Studio public REST API lacks transactional campaign delivery; rows remain provider_capability_blocked until supported.';
