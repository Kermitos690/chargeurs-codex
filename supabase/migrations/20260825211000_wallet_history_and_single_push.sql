-- Keep a stable, authenticated view of the ten most recent Wallet notifications.
create or replace function public.customer_wallet_notification_history(p_limit integer default 10)
returns table (
  id uuid,
  event_type text,
  title text,
  message text,
  created_at timestamptz,
  delivered_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  return query
  select n.id, n.event_type, n.title, n.message, n.created_at, n.delivered_at
  from public.customer_wallet_native_notifications n
  where n.user_id = auth.uid()
    and n.status = 'delivered'
  order by n.created_at desc
  limit least(greatest(coalesce(p_limit, 10), 1), 10);
end;
$$;

-- Rental lifecycle notifications already update current per-holder fields and
-- carry the native Wallet message in the same Pass Studio PATCH. Do not enqueue
-- a second field-only update for the same rental event: that would duplicate
-- provider pushes and consume a second Pass Studio credit.
create or replace function public.customer_wallet_realtime_rental_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  return new;
end;
$$;
