-- Recover safely from a server-side enrollment that completed before the APK
-- managed to persist its local encrypted configuration. A fresh, valid pairing
-- code for the same station may rotate the token of the same physical device.
-- Moving an already known device to another station remains fail-closed.

create or replace function public.redeem_kiosk_pairing_code(
  p_code_hash text,
  p_token_hash text,
  p_device_public_id uuid,
  p_app_version text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pairing public.kiosk_pairing_codes%rowtype;
  v_device public.kiosk_devices%rowtype;
  v_recovered boolean := false;
begin
  if p_code_hash is null or length(p_code_hash) <> 64
     or p_token_hash is null or length(p_token_hash) <> 64
     or p_device_public_id is null then
    return jsonb_build_object('ok', false, 'error', 'INVALID_ENROLLMENT_REQUEST');
  end if;

  select * into v_pairing
  from public.kiosk_pairing_codes
  where code_hash = p_code_hash
    and used_at is null
    and expires_at > now()
  for update skip locked;

  if v_pairing.id is null then
    return jsonb_build_object('ok', false, 'error', 'INVALID_OR_EXPIRED_PAIRING_CODE');
  end if;

  if v_pairing.organization_id is null then
    return jsonb_build_object('ok', false, 'error', 'PAIRING_ORGANIZATION_MISSING');
  end if;

  select * into v_device
  from public.kiosk_devices
  where device_public_id = p_device_public_id
  for update;

  if found then
    if v_device.station_id <> v_pairing.station_id
       or v_device.organization_id is distinct from v_pairing.organization_id then
      return jsonb_build_object('ok', false, 'error', 'DEVICE_BOUND_TO_ANOTHER_STATION');
    end if;

    update public.kiosk_devices
    set token_hash = p_token_hash,
        active = true,
        token_revoked = false,
        token_expires_at = null,
        token_rotated_at = now(),
        app_version = left(coalesce(p_app_version, ''), 64),
        enrolled_at = coalesce(enrolled_at, now()),
        revoked_at = null,
        label = coalesce(v_pairing.label, label)
    where id = v_device.id
    returning * into v_device;
    v_recovered := true;
  else
    insert into public.kiosk_devices (
      station_id, organization_id, label, token_hash, active, token_revoked,
      token_rotated_at, device_public_id, app_version, enrolled_at
    ) values (
      v_pairing.station_id, v_pairing.organization_id, v_pairing.label,
      p_token_hash, true, false, now(), p_device_public_id,
      left(coalesce(p_app_version, ''), 64), now()
    ) returning * into v_device;
  end if;

  update public.kiosk_pairing_codes
  set used_at = now(), used_by_device_id = v_device.id
  where id = v_pairing.id and used_at is null;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'PAIRING_CODE_ALREADY_USED');
  end if;

  insert into public.audit_logs(action, target, data)
  values (
    case when v_recovered then 'kiosk.enrollment.recovered' else 'kiosk.enrollment.redeemed' end,
    v_device.id::text,
    jsonb_build_object(
      'station_id', v_device.station_id,
      'organization_id', v_device.organization_id,
      'device_public_id', v_device.device_public_id,
      'app_version', v_device.app_version,
      'recovered', v_recovered
    )
  );

  return jsonb_build_object(
    'ok', true,
    'device_id', v_device.id,
    'station_id', v_device.station_id,
    'organization_id', v_device.organization_id,
    'recovered', v_recovered
  );
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'PAIRING_CODE_ALREADY_USED');
end;
$$;

revoke execute on function public.redeem_kiosk_pairing_code(text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.redeem_kiosk_pairing_code(text, text, uuid, text)
  to service_role;
