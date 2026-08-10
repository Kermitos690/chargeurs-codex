create or replace function public.self_enroll_staging_kiosk(
  p_station_id text,
  p_token_hash text,
  p_device_public_id uuid,
  p_app_version text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_station public.stations%rowtype;
  v_device public.kiosk_devices%rowtype;
begin
  if p_station_id is null
     or p_station_id !~ '^[A-Za-z0-9_-]{4,32}$'
     or p_token_hash is null
     or length(p_token_hash) <> 64
     or p_device_public_id is null
     or p_app_version is null
     or p_app_version not like '%-staging-diagnostic' then
    return jsonb_build_object('ok', false, 'error', 'INVALID_TEST_ENROLLMENT_REQUEST');
  end if;

  select * into v_station
  from public.stations
  where station_id = p_station_id
    and environment = 'staging'
    and is_pilot = true
  for update;

  if v_station.station_id is null then
    return jsonb_build_object('ok', false, 'error', 'TEST_STATION_NOT_ALLOWED');
  end if;

  if v_station.organization_id is null then
    return jsonb_build_object('ok', false, 'error', 'TEST_STATION_ORGANIZATION_MISSING');
  end if;

  select * into v_device
  from public.kiosk_devices
  where device_public_id = p_device_public_id
  for update;

  if found and v_device.station_id <> v_station.station_id then
    return jsonb_build_object('ok', false, 'error', 'DEVICE_BOUND_TO_ANOTHER_STATION');
  end if;

  update public.kiosk_devices
  set active = false,
      token_revoked = true,
      revoked_at = now()
  where station_id = v_station.station_id
    and device_public_id is distinct from p_device_public_id
    and app_version like '%-staging-diagnostic'
    and active = true;

  if v_device.id is not null then
    update public.kiosk_devices
    set organization_id = v_station.organization_id,
        label = 'Diagnostic auto-enrollment ' || v_station.station_id,
        token_hash = p_token_hash,
        active = true,
        token_revoked = false,
        token_expires_at = now() + interval '7 days',
        token_rotated_at = now(),
        app_version = left(p_app_version, 64),
        enrolled_at = coalesce(enrolled_at, now()),
        revoked_at = null
    where id = v_device.id
    returning * into v_device;
  else
    insert into public.kiosk_devices (
      station_id,
      organization_id,
      label,
      token_hash,
      active,
      token_revoked,
      token_expires_at,
      token_rotated_at,
      device_public_id,
      app_version,
      enrolled_at
    ) values (
      v_station.station_id,
      v_station.organization_id,
      'Diagnostic auto-enrollment ' || v_station.station_id,
      p_token_hash,
      true,
      false,
      now() + interval '7 days',
      now(),
      p_device_public_id,
      left(p_app_version, 64),
      now()
    ) returning * into v_device;
  end if;

  insert into public.audit_logs(action, target, data)
  values (
    'kiosk.test_self_enrollment',
    v_device.id::text,
    jsonb_build_object(
      'station_id', v_device.station_id,
      'organization_id', v_device.organization_id,
      'device_public_id', v_device.device_public_id,
      'app_version', v_device.app_version,
      'expires_at', v_device.token_expires_at,
      'test_only', true
    )
  );

  return jsonb_build_object(
    'ok', true,
    'device_id', v_device.id,
    'station_id', v_device.station_id,
    'organization_id', v_device.organization_id,
    'token_expires_at', v_device.token_expires_at,
    'test_only', true
  );
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'TEST_ENROLLMENT_CONFLICT');
end;
$$;

revoke execute on function public.self_enroll_staging_kiosk(text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.self_enroll_staging_kiosk(text, text, uuid, text)
  to service_role;
