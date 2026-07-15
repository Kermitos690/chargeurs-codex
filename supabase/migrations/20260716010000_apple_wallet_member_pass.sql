-- Chargeurs.ch Apple Wallet member pass
-- Server-generated passes only. No certificate material is stored in PostgreSQL.

create extension if not exists pgcrypto;

alter table public.profiles
  add column if not exists member_number text,
  add column if not exists account_status text not null default 'active';

create unique index if not exists profiles_member_number_unique
  on public.profiles(member_number)
  where member_number is not null;

create or replace function public.ensure_member_number(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member text;
begin
  select member_number into v_member
  from public.profiles
  where id = p_user_id
  for update;

  if v_member is null then
    v_member := 'CHG-' || upper(substr(replace(p_user_id::text, '-', ''), 1, 10));
    update public.profiles set member_number = v_member where id = p_user_id;
  end if;

  return v_member;
end;
$$;

revoke all on function public.ensure_member_number(uuid) from public, anon, authenticated;
grant execute on function public.ensure_member_number(uuid) to service_role;

create table if not exists public.wallet_passes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  serial_number text not null unique,
  pass_type_identifier text not null,
  qr_token_hash text not null unique,
  qr_token_last_four text not null,
  apple_authentication_token_hash text not null,
  status text not null default 'active' check (status in ('active','revoked','suspended')),
  pass_version bigint not null default 1 check (pass_version > 0),
  visible_data_hash text,
  last_generated_at timestamptz,
  last_updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, pass_type_identifier)
);

create index if not exists wallet_passes_user_idx on public.wallet_passes(user_id);
create index if not exists wallet_passes_updated_idx on public.wallet_passes(pass_type_identifier, last_updated_at);

create table if not exists public.wallet_device_registrations (
  id uuid primary key default gen_random_uuid(),
  wallet_pass_id uuid not null references public.wallet_passes(id) on delete cascade,
  device_library_identifier text not null,
  push_token text not null,
  registered_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unregistered_at timestamptz,
  unique(wallet_pass_id, device_library_identifier)
);

create index if not exists wallet_device_registrations_device_idx
  on public.wallet_device_registrations(device_library_identifier)
  where unregistered_at is null;

create table if not exists public.wallet_pass_events (
  id uuid primary key default gen_random_uuid(),
  wallet_pass_id uuid not null references public.wallet_passes(id) on delete cascade,
  event_type text not null,
  previous_version bigint,
  new_version bigint,
  reason text,
  result text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists wallet_pass_events_pass_created_idx
  on public.wallet_pass_events(wallet_pass_id, created_at desc);

alter table public.wallet_passes enable row level security;
alter table public.wallet_device_registrations enable row level security;
alter table public.wallet_pass_events enable row level security;

-- Owners may inspect their pass metadata, never its hashes or device push tokens through the client.
drop policy if exists "Wallet owners read own pass" on public.wallet_passes;
create policy "Wallet owners read own pass"
  on public.wallet_passes for select to authenticated
  using (user_id = auth.uid());

-- All writes and Apple web-service reads go through service-role Edge Functions.
revoke all on public.wallet_device_registrations from anon, authenticated;
revoke all on public.wallet_pass_events from anon, authenticated;

-- Return only safe owner-facing metadata.
create or replace view public.my_wallet_pass
with (security_invoker = true)
as
select id, user_id, serial_number, pass_type_identifier, qr_token_last_four,
       status, pass_version, last_generated_at, last_updated_at, revoked_at,
       created_at, updated_at
from public.wallet_passes
where user_id = auth.uid();

grant select on public.my_wallet_pass to authenticated;

create or replace function public.touch_wallet_pass(
  p_pass_id uuid,
  p_reason text,
  p_visible_data_hash text default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old bigint;
  v_new bigint;
begin
  select pass_version into v_old from public.wallet_passes where id = p_pass_id for update;
  if v_old is null then raise exception 'WALLET_PASS_NOT_FOUND'; end if;
  v_new := v_old + 1;
  update public.wallet_passes
     set pass_version = v_new,
         visible_data_hash = coalesce(p_visible_data_hash, visible_data_hash),
         last_updated_at = now(),
         updated_at = now()
   where id = p_pass_id;
  insert into public.wallet_pass_events(wallet_pass_id,event_type,previous_version,new_version,reason,result)
  values (p_pass_id,'pass_updated',v_old,v_new,p_reason,'queued');
  return v_new;
end;
$$;

revoke all on function public.touch_wallet_pass(uuid,text,text) from public, anon, authenticated;
grant execute on function public.touch_wallet_pass(uuid,text,text) to service_role;
