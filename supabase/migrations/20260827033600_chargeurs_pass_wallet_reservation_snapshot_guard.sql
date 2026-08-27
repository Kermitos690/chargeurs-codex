-- Defense in depth: a real-money wallet reservation is only valid for the
-- canonical member pricing snapshot used by the Chargeurs Pass pilot.

create or replace function public.enforce_pass_wallet_reservation_snapshot()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_snapshot jsonb;
  v_user_id uuid;
begin
  select pricing_snapshot,customer_user_id into v_snapshot,v_user_id
  from public.rental_sessions
  where id=new.rental_session_id;

  if not found then raise exception 'PASS_WALLET_RENTAL_NOT_FOUND'; end if;
  if v_user_id is distinct from new.user_id then raise exception 'PASS_WALLET_RESERVATION_USER_MISMATCH'; end if;
  if upper(coalesce(new.currency,''))<>'CHF' or new.held_cents<>3000 then
    raise exception 'PASS_WALLET_RESERVATION_AMOUNT_INVALID';
  end if;
  if v_snapshot is null
     or coalesce((v_snapshot->>'pricing_rules_version')::integer,0)<>3
     or coalesce(v_snapshot->>'customer_segment','')<>'member'
     or upper(coalesce(v_snapshot->>'currency',''))<>'CHF'
     or coalesce((v_snapshot->>'deposit_cents')::integer,0)<>3000
     or coalesce((v_snapshot->>'unreturned_fee_cents')::integer,0)<>3000
     or coalesce((v_snapshot->>'unreturned_after_minutes')::integer,0)<>7200
     or coalesce((v_snapshot->>'max_amount_cents')::integer,0)<>3000 then
    raise exception 'PASS_WALLET_CANONICAL_V3_SNAPSHOT_REQUIRED';
  end if;

  return new;
end;
$function$;

revoke all on function public.enforce_pass_wallet_reservation_snapshot() from public,anon,authenticated;
grant execute on function public.enforce_pass_wallet_reservation_snapshot() to service_role;

drop trigger if exists trg_enforce_pass_wallet_reservation_snapshot on public.wallet_rental_reservations;
create trigger trg_enforce_pass_wallet_reservation_snapshot
before insert or update of rental_session_id,wallet_id,user_id,currency,held_cents
on public.wallet_rental_reservations
for each row execute function public.enforce_pass_wallet_reservation_snapshot();
