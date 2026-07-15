-- Increment Wallet pass versions only when data displayed on the pass may have changed.

create or replace function public.queue_wallet_pass_update_for_user(
  p_user_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pass_id uuid;
begin
  if p_user_id is null then return; end if;
  for v_pass_id in
    select id from public.wallet_passes
    where user_id = p_user_id and status = 'active'
  loop
    perform public.touch_wallet_pass(v_pass_id, p_reason, null);
  end loop;
end;
$$;

revoke all on function public.queue_wallet_pass_update_for_user(uuid,text) from public, anon, authenticated;
grant execute on function public.queue_wallet_pass_update_for_user(uuid,text) to service_role;

create or replace function public.wallet_profile_changed_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT'
     or (to_jsonb(old) - array['updated_at']) is distinct from (to_jsonb(new) - array['updated_at']) then
    perform public.queue_wallet_pass_update_for_user(new.id, 'profile_changed');
  end if;
  return new;
end;
$$;

drop trigger if exists wallet_profile_changed on public.profiles;
create trigger wallet_profile_changed
after insert or update on public.profiles
for each row execute function public.wallet_profile_changed_trigger();

create or replace function public.wallet_rental_changed_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_old jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  v_user_id uuid;
  v_email text;
  v_visible_old jsonb;
  v_visible_new jsonb;
begin
  v_visible_old := v_old -> array['state','station_id','battery_id','created_at','paid_at','ejected_at','returned_at','closed_at'];
  v_visible_new := v_row -> array['state','station_id','battery_id','created_at','paid_at','ejected_at','returned_at','closed_at'];
  if tg_op = 'UPDATE' and v_visible_old is not distinct from v_visible_new then
    return coalesce(new, old);
  end if;

  begin v_user_id := nullif(v_row ->> 'customer_user_id', '')::uuid; exception when others then v_user_id := null; end;
  v_email := nullif(lower(v_row ->> 'customer_email'), '');
  if v_user_id is null and v_email is not null then
    select id into v_user_id from auth.users where lower(email) = v_email limit 1;
  end if;
  perform public.queue_wallet_pass_update_for_user(v_user_id, 'rental_changed');
  return coalesce(new, old);
end;
$$;

drop trigger if exists wallet_rental_changed on public.rental_sessions;
create trigger wallet_rental_changed
after insert or update or delete on public.rental_sessions
for each row execute function public.wallet_rental_changed_trigger();

-- Optional tables differ between deployments. Attach a generic trigger only when present.
create or replace function public.wallet_generic_user_changed_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_user_id uuid;
begin
  begin v_user_id := nullif(v_row ->> 'user_id', '')::uuid; exception when others then v_user_id := null; end;
  perform public.queue_wallet_pass_update_for_user(v_user_id, lower(tg_table_name) || '_changed');
  return coalesce(new, old);
end;
$$;

do $$
begin
  if to_regclass('public.wallets') is not null then
    execute 'drop trigger if exists wallet_balance_changed on public.wallets';
    execute 'create trigger wallet_balance_changed after insert or update or delete on public.wallets for each row execute function public.wallet_generic_user_changed_trigger()';
  end if;
  if to_regclass('public.subscriptions') is not null then
    execute 'drop trigger if exists wallet_subscription_changed on public.subscriptions';
    execute 'create trigger wallet_subscription_changed after insert or update or delete on public.subscriptions for each row execute function public.wallet_generic_user_changed_trigger()';
  end if;
end $$;
