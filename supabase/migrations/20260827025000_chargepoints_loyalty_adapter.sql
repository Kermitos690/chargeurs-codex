-- Loyalty adapter over the existing immutable Charge Points ledger.
-- Keeps the historical 8-argument primitive untouched while providing the
-- richer event shape used by campaigns/missions/rewards.
create or replace function public.append_customer_chargepoints(
  p_user_id uuid,
  p_delta bigint,
  p_entry_type text,
  p_reason text,
  p_source_type text,
  p_source_id uuid,
  p_rental_session_id uuid,
  p_idempotency_key text,
  p_metadata jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_entry public.customer_chargepoints_ledger%rowtype;
  v_balance bigint;
begin
  if p_delta = 0 or p_delta > 2147483647 or p_delta < -2147483648 then
    raise exception 'CHARGEPOINTS_DELTA_OUT_OF_RANGE';
  end if;
  if p_entry_type not in ('earn','redeem','adjustment','expiration','reversal') then
    raise exception 'CHARGEPOINTS_ENTRY_TYPE_INVALID';
  end if;

  select * into v_entry
  from public.append_customer_chargepoints(
    p_user_id,
    p_delta::integer,
    p_reason,
    p_source_type,
    coalesce(p_source_id::text,''),
    p_idempotency_key,
    null,
    coalesce(p_metadata,'{}'::jsonb) || jsonb_build_object(
      'entry_type',p_entry_type,
      'rental_session_id',p_rental_session_id
    )
  );

  select coalesce(balance,0) into v_balance
  from public.customer_chargepoints_balances
  where user_id=p_user_id;

  return coalesce(v_balance,0);
end;
$function$;

revoke all on function public.append_customer_chargepoints(uuid,bigint,text,text,text,uuid,uuid,text,jsonb) from public, anon;
grant execute on function public.append_customer_chargepoints(uuid,bigint,text,text,text,uuid,uuid,text,jsonb) to authenticated, service_role;
