create or replace function public.claim_rental_settlement(
  p_rental_id uuid,
  p_lock_ttl_minutes integer default 10
)
returns public.rental_sessions
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_session public.rental_sessions;
begin
  if p_lock_ttl_minutes < 1 or p_lock_ttl_minutes > 120 then
    raise exception using errcode = '22023', message = 'INVALID_LOCK_TTL';
  end if;

  update public.rental_sessions
  set settlement_status = 'settling',
      settlement_locked_at = now(),
      settlement_attempts = coalesce(settlement_attempts, 0) + 1
  where id = p_rental_id
    and settlement_status <> 'settled'
    and coalesce(settlement_attempts, 0) < 3
    and (
      settlement_locked_at is null
      or settlement_locked_at < now() - make_interval(mins => p_lock_ttl_minutes)
    )
    and (
      settlement_status in ('pending', 'authorized', 'prepaid')
      or (
        settlement_status = 'settling'
        and settlement_locked_at < now() - make_interval(mins => p_lock_ttl_minutes)
      )
      or (
        settlement_status in ('failed', 'supplemental_required')
        and updated_at < now() - interval '5 minutes'
      )
    )
  returning * into v_session;

  if not found then
    return null;
  end if;

  return v_session;
end;
$function$;
