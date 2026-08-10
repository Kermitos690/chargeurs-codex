alter table public.customer_memberships
  add column if not exists current_period_start timestamptz,
  add column if not exists current_period_end timestamptz;

update public.customer_memberships
set current_period_start = coalesce(current_period_start, starts_at),
    current_period_end = coalesce(current_period_end, renews_at, ends_at)
where current_period_start is null or current_period_end is null;

create table if not exists public.customer_membership_usage_ledger (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.customer_memberships(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rental_session_id uuid references public.rental_sessions(id) on delete set null,
  period_start timestamptz not null,
  period_end timestamptz,
  minutes_consumed integer not null,
  idempotency_key text not null unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint customer_membership_usage_minutes_check check (minutes_consumed > 0),
  constraint customer_membership_usage_period_check check (period_end is null or period_end > period_start)
);
create index if not exists customer_membership_usage_membership_period_idx on public.customer_membership_usage_ledger(membership_id,period_start,period_end);
create index if not exists customer_membership_usage_user_idx on public.customer_membership_usage_ledger(user_id,created_at desc);
alter table public.customer_membership_usage_ledger enable row level security;
drop policy if exists "users read own membership usage" on public.customer_membership_usage_ledger;
create policy "users read own membership usage" on public.customer_membership_usage_ledger for select to authenticated using (auth.uid()=user_id);

create or replace function public.prevent_membership_usage_mutation()
returns trigger language plpgsql security definer set search_path=public as $function$
begin
  raise exception using errcode='55000',message='MEMBERSHIP_USAGE_LEDGER_IMMUTABLE';
end;
$function$;
drop trigger if exists trg_membership_usage_immutable on public.customer_membership_usage_ledger;
create trigger trg_membership_usage_immutable before update or delete on public.customer_membership_usage_ledger
for each row execute function public.prevent_membership_usage_mutation();

create or replace view public.customer_membership_usage_balances with (security_invoker=true) as
select m.id as membership_id,m.user_id,p.included_minutes,m.current_period_start,m.current_period_end,
       coalesce(sum(u.minutes_consumed) filter (where u.period_start=m.current_period_start and (m.current_period_end is null or u.period_end=m.current_period_end)),0)::integer as minutes_consumed,
       case when p.included_minutes is null then null else greatest(0,p.included_minutes-coalesce(sum(u.minutes_consumed) filter (where u.period_start=m.current_period_start and (m.current_period_end is null or u.period_end=m.current_period_end)),0)::integer) end as minutes_remaining
from public.customer_memberships m
join public.customer_membership_plans p on p.id=m.plan_id
left join public.customer_membership_usage_ledger u on u.membership_id=m.id
group by m.id,m.user_id,p.included_minutes,m.current_period_start,m.current_period_end;
grant select on public.customer_membership_usage_balances to authenticated;

-- Deliberately not auto-populated yet. Account-specific included minutes must
-- be applied to pricing BEFORE the immutable rental snapshot is created.
