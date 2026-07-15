-- Fixed-window rate limiting for sensitive Apple Wallet endpoints.

create table if not exists public.wallet_rate_limits (
  rate_key text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 1 check (request_count > 0),
  updated_at timestamptz not null default now(),
  primary key(rate_key, window_started_at)
);

alter table public.wallet_rate_limits enable row level security;
revoke all on public.wallet_rate_limits from public, anon, authenticated;

create or replace function public.claim_wallet_rate_limit(
  p_rate_key text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window timestamptz;
  v_count integer;
begin
  if p_rate_key is null or length(p_rate_key) < 8 or length(p_rate_key) > 200 then
    return false;
  end if;
  if p_limit < 1 or p_limit > 1000 or p_window_seconds < 1 or p_window_seconds > 86400 then
    return false;
  end if;

  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.wallet_rate_limits(rate_key, window_started_at, request_count, updated_at)
  values (p_rate_key, v_window, 1, now())
  on conflict (rate_key, window_started_at)
  do update set request_count = public.wallet_rate_limits.request_count + 1, updated_at = now()
  returning request_count into v_count;

  return v_count <= p_limit;
end;
$$;

revoke all on function public.claim_wallet_rate_limit(text,integer,integer) from public, anon, authenticated;
grant execute on function public.claim_wallet_rate_limit(text,integer,integer) to service_role;

-- Best-effort cleanup; deployment scheduler may call it daily.
create or replace function public.cleanup_wallet_rate_limits()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.wallet_rate_limits where window_started_at < now() - interval '2 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.cleanup_wallet_rate_limits() from public, anon, authenticated;
grant execute on function public.cleanup_wallet_rate_limits() to service_role;
