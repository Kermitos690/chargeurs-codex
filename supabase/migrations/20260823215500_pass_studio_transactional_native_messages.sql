-- Pass Studio confirmed that PATCH /api/v1/instances/fields accepts an optional `message`
-- parameter which delivers a native Apple Wallet lock-screen banner and a Google Wallet
-- notification to the specific instance. Promote the native notification outbox from
-- capability-blocked intents to a real retryable delivery queue.

-- Do not replay historical alerts that were created while the capability was considered unavailable.
update public.customer_wallet_native_notifications
set status = 'expired',
    last_error_code = 'SUPERSEDED_BEFORE_TRANSACTIONAL_MESSAGE_SUPPORT',
    updated_at = now()
where status = 'provider_capability_blocked';

alter table public.customer_wallet_native_notifications
  add column if not exists attempts integer not null default 0,
  add column if not exists next_attempt_at timestamptz not null default now(),
  add column if not exists expires_at timestamptz null;

alter table public.customer_wallet_native_notifications
  alter column status set default 'pending',
  alter column provider_capability set default 'instances_fields_message';

alter table public.customer_wallet_native_notifications
  drop constraint if exists customer_wallet_native_notifications_status_check;

alter table public.customer_wallet_native_notifications
  add constraint customer_wallet_native_notifications_status_check
  check (status in ('provider_capability_blocked','pending','processing','delivered','failed','expired'));

create index if not exists customer_wallet_native_notifications_due_idx
  on public.customer_wallet_native_notifications(status, next_attempt_at, created_at)
  where status = 'pending';

create or replace function public.queue_customer_wallet_native_notification_from_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expires_at timestamptz;
begin
  if new.channel <> 'push' or new.user_id is null then
    return new;
  end if;

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

  v_expires_at := case
    when new.type in ('price_stage_changed','daily_cap_reached') then now() + interval '30 minutes'
    when new.type in ('rental_completed','chargepoints_bonus','membership_renewed','membership_cancelled','membership_expired') then now() + interval '24 hours'
    else now() + interval '2 hours'
  end;

  insert into public.customer_wallet_native_notifications(
    user_id,
    source_notification_id,
    event_type,
    event_key,
    title,
    message,
    metadata,
    provider,
    provider_capability,
    status,
    attempts,
    next_attempt_at,
    expires_at,
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
    'pass_studio',
    'instances_fields_message',
    'pending',
    0,
    now(),
    v_expires_at,
    null
  )
  on conflict (event_key) do nothing;

  return new;
end;
$$;

revoke all on function public.queue_customer_wallet_native_notification_from_push() from public, anon, authenticated;

comment on table public.customer_wallet_native_notifications is
  'Retryable per-holder native Wallet notification queue. Pass Studio delivers through PATCH /instances/fields with message to the specific instanceId.';
