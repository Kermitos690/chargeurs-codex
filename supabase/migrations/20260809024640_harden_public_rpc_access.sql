-- Harden callable SECURITY DEFINER helpers without breaking RLS evaluation.
-- These functions are intentionally callable by authenticated users because
-- policies invoke them. Their subject must always be the caller itself, so an
-- RPC client cannot test another user's roles.

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select auth.uid()) = _user_id, false)
    and exists (
      select 1 from public.user_roles
      where user_id = _user_id and role = _role
    )
$$;

create or replace function public.has_role_name(_user_id uuid, _role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select auth.uid()) = _user_id, false)
    and exists (
      select 1 from public.user_roles
      where user_id = _user_id and role::text = _role
    )
$$;

create or replace function public.has_any_role(_user_id uuid, _roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select auth.uid()) = _user_id, false)
    and exists (
      select 1 from public.user_roles
      where user_id = _user_id and role::text = any(_roles)
    )
$$;

-- `kiosk_quote` and `kiosk_session_status` must remain publicly callable: an
-- unlogged-in kiosk/payment page uses a station-bound token or a per-session
-- bearer code. Their function bodies validate that capability and return only
-- their narrowly scoped public projections. Keep these grants explicit.
revoke all on function public.kiosk_quote(text, text) from public;
grant execute on function public.kiosk_quote(text, text) to anon, authenticated, service_role;

revoke all on function public.kiosk_session_status(uuid, text) from public;
grant execute on function public.kiosk_session_status(uuid, text) to anon, authenticated, service_role;
