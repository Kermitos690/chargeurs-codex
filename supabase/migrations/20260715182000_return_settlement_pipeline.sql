-- Exact battery-return correlation and asynchronous financial settlement pipeline.

create extension if not exists pgcrypto;

alter table public.rental_sessions
  add column if not exists battery_id text,
  add column if not exists return_station_id text,
  add column if not exists returned_slot_num integer,
  add column if not exists return_external_event_id text,
  add column if not exists final_pricing_snapshot jsonb,
  add column if not exists settlement_status text not null default 'not_started',
  add column if not exists settlement_requested_at timestamptz,
  add column if not exists settlement_completed_at timestamptz,
  add column if not exists settlement_error text;

alter table public.rental_sessions
  drop constraint if exists rental_sessions_settlement_status_check;
alter table public.rental_sessions
  add constraint rental_sessions_settlement_status_check check (
    settlement_status in ('not_started','queued','processing','completed','additional_payment_required','failed','manual_review')
  );

create index if not exists rental_sessions_battery_active_idx
  on public.rental_sessions(battery_id, state)
  where battery_id is not null;

create unique index if not exists rental_sessions_return_external_event_uidx
  on public.rental_sessions(return_external_event_id)
  where return_external_event_id is not null;

create table if not exists public.rental_settlement_jobs (
  id uuid primary key default gen_random_uuid(),
  rental_session_id uuid not null references public.rental_sessions(id) on delete cascade,
  reason text not null default 'returned' check (reason in ('returned','non_return','cancelled','release_failed')),
  source text not null check (source in ('chargenow_callback','cabinet_event','admin','reconciliation','system')),
  external_event_id text not null,
  status text not null default 'pending' check (status in ('pending','processing','succeeded','retry','dead')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rental_settlement_jobs_external_event_unique unique (source, external_event_id),
  constraint rental_settlement_jobs_rental_reason_unique unique (rental_session_id, reason)
);

create index if not exists rental_settlement_jobs_pending_idx
  on public.rental_settlement_jobs(available_at, created_at)
  where status in ('pending','retry');

create or replace function public.claim_rental_settlement_jobs(p_limit integer default 10)
returns setof public.rental_settlement_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select id
    from public.rental_settlement_jobs
    where status in ('pending','retry')
      and available_at <= now()
      and (locked_at is null or locked_at < now() - interval '5 minutes')
    order by available_at, created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 10), 50))
  )
  update public.rental_settlement_jobs j
  set status = 'processing',
      locked_at = now(),
      attempt_count = j.attempt_count + 1,
      updated_at = now()
  from candidates c
  where j.id = c.id
  returning j.*;
end;
$$;

create or replace function public.finish_rental_settlement_job(
  p_job_id uuid,
  p_succeeded boolean,
  p_result jsonb default null,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempts integer;
begin
  select attempt_count into v_attempts
  from public.rental_settlement_jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'SETTLEMENT_JOB_NOT_FOUND';
  end if;

  if p_succeeded then
    update public.rental_settlement_jobs
    set status = 'succeeded', result = coalesce(p_result, '{}'::jsonb), last_error = null,
        locked_at = null, updated_at = now()
    where id = p_job_id;
  elsif v_attempts >= 8 then
    update public.rental_settlement_jobs
    set status = 'dead', last_error = left(coalesce(p_error, 'UNKNOWN_ERROR'), 2000),
        locked_at = null, updated_at = now()
    where id = p_job_id;
  else
    update public.rental_settlement_jobs
    set status = 'retry', last_error = left(coalesce(p_error, 'UNKNOWN_ERROR'), 2000),
        available_at = now() + case
          when v_attempts <= 1 then interval '1 minute'
          when v_attempts = 2 then interval '5 minutes'
          when v_attempts = 3 then interval '30 minutes'
          when v_attempts = 4 then interval '2 hours'
          when v_attempts = 5 then interval '12 hours'
          else interval '24 hours'
        end,
        locked_at = null, updated_at = now()
    where id = p_job_id;
  end if;
end;
$$;

alter table public.rental_settlement_jobs enable row level security;
revoke all on public.rental_settlement_jobs from anon, authenticated;
revoke execute on function public.claim_rental_settlement_jobs(integer) from public, anon, authenticated;
revoke execute on function public.finish_rental_settlement_job(uuid, boolean, jsonb, text) from public, anon, authenticated;
grant execute on function public.claim_rental_settlement_jobs(integer) to service_role;
grant execute on function public.finish_rental_settlement_job(uuid, boolean, jsonb, text) to service_role;
