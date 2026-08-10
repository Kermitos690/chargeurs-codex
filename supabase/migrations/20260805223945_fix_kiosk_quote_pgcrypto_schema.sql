create or replace function public.kiosk_quote(p_token text, p_station text)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_hash text;
  v_dev record;
  v_quote jsonb;
  v_profile public.price_profiles%rowtype;
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

  update public.kiosk_devices
     set last_seen_at = now()
   where id = v_dev.id;

  v_quote := public.compute_pricing(v_dev.station_id, p_station, null, now(), null, 'quote', 'normal', null);

  select * into v_profile
  from public.price_profiles
  where id = (v_quote ->> 'profile_id')::uuid;

  if v_profile.id is null then
    return jsonb_build_object('error', 'PRICING_NOT_CONFIGURED');
  end if;

  return v_quote || jsonb_build_object(
    'price_per_period_cents', v_profile.price_per_period_cents,
    'daily_cap_cents', v_profile.daily_cap_cents,
    'max_amount_cents', v_profile.max_amount_cents,
    'unreturned_fee_cents', v_profile.unreturned_fee_cents
  );
exception when others then
  return jsonb_build_object('error', 'PRICING_NOT_CONFIGURED');
end;
$function$;
