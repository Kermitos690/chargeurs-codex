-- Keep the existing kiosk_quote contract, but make its price follow the most
-- recent verified, unconsumed account pairing for this exact kiosk+station.
-- Anonymous/blue sessions remain guest; member pricing can never be requested
-- by a browser flag because the segment is derived from a service-only table.

create or replace function public.kiosk_quote(p_token text, p_station text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
  v_dev record;
  v_segment text := 'guest';
  v_quote jsonb;
begin
  if p_token is null or length(p_token) < 24 or p_station is null then
    return jsonb_build_object('error', 'KIOSK_AUTH_REQUIRED');
  end if;

  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  select id, station_id into v_dev
  from public.kiosk_devices
  where token_hash = v_hash
    and active = true
    and coalesce(token_revoked, false) = false
    and (token_expires_at is null or token_expires_at > now())
    and station_id = p_station
  limit 1;

  if v_dev.id is null then
    return jsonb_build_object('error', 'KIOSK_AUTH_INVALID');
  end if;

  update public.kiosk_devices set last_seen_at = now() where id = v_dev.id;

  if exists (
    select 1 from public.customer_pairing_sessions cps
    where cps.kiosk_device_id = v_dev.id
      and cps.station_id = p_station
      and cps.state = 'claimed'
      and cps.segment = 'member'
      and cps.customer_user_id is not null
      and cps.consumed_at is null
      and cps.expires_at > now()
  ) then
    v_segment := 'member';
  end if;

  v_quote := public.compute_customer_pricing_snapshot(
    p_station, v_segment, now(), null, 'quote', 'normal', null
  );

  return v_quote;
exception when others then
  return jsonb_build_object('error', 'PRICING_NOT_CONFIGURED');
end;
$$;

revoke all on function public.kiosk_quote(text,text) from public;
grant execute on function public.kiosk_quote(text,text) to anon, authenticated, service_role;
