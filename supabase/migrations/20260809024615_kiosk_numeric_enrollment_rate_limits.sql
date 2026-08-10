-- Numeric kiosk activation hardening. This migration is additive: existing
-- opaque historical codes remain redeemable until their normal expiry, while
-- newly generated codes are exactly six digits. No plaintext pairing code,
-- raw IP address or kiosk token is persisted.

alter table public.kiosk_pairing_codes
  add column if not exists failed_attempt_count integer not null default 0
    check (failed_attempt_count >= 0),
  add column if not exists last_failed_attempt_at timestamptz;

create table if not exists public.kiosk_enrollment_attempts (
  id uuid primary key default gen_random_uuid(),
  device_public_id uuid not null,
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  station_id text,
  pairing_code_hash text not null check (pairing_code_hash ~ '^[0-9a-f]{64}$'),
  outcome text not null check (outcome in ('rejected', 'rate_limited', 'accepted')),
  created_at timestamptz not null default now()
);

create index if not exists kiosk_enrollment_attempts_device_recent_idx
  on public.kiosk_enrollment_attempts(device_public_id, created_at desc);
create index if not exists kiosk_enrollment_attempts_source_recent_idx
  on public.kiosk_enrollment_attempts(source_hash, created_at desc);
create index if not exists kiosk_enrollment_attempts_station_recent_idx
  on public.kiosk_enrollment_attempts(station_id, created_at desc)
  where station_id is not null;

alter table public.kiosk_enrollment_attempts enable row level security;
revoke all on table public.kiosk_enrollment_attempts from anon, authenticated;
grant all on table public.kiosk_enrollment_attempts to service_role;

-- A SECURITY DEFINER function is necessary because enrollment is unauthenticated
-- by design. It is never executable by browser roles; only the server-side
-- kiosk-enroll Edge Function may call it using service_role credentials.
create or replace function public.redeem_kiosk_pairing_code(
  p_code_hash text,
  p_token_hash text,
  p_device_public_id uuid,
  p_app_version text,
  p_source_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pairing public.kiosk_pairing_codes%rowtype;
  v_device public.kiosk_devices%rowtype;
  v_recent_device integer := 0;
  v_recent_source integer := 0;
  v_recent_station integer := 0;
  v_last_failure timestamptz;
  v_delay_seconds integer := 0;
  v_recovered boolean := false;
begin
  if p_code_hash is null or length(p_code_hash) <> 64
     or p_token_hash is null or length(p_token_hash) <> 64
     or p_device_public_id is null
     or p_source_hash is null or p_source_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'error', 'INVALID_ENROLLMENT_REQUEST');
  end if;

  -- Resolve a station only from the submitted hash. This never stores or
  -- returns the numeric code itself; old/expired rows are used solely to
  -- apply the station-level throttle and create an audit-safe event.
  select * into v_pairing
  from public.kiosk_pairing_codes
  where code_hash = p_code_hash
  order by created_at desc
  limit 1
  for update skip locked;

  select count(*), max(created_at)
    into v_recent_device, v_last_failure
  from public.kiosk_enrollment_attempts
  where device_public_id = p_device_public_id
    and outcome in ('rejected', 'rate_limited')
    and created_at > now() - interval '10 minutes';

  select count(*) into v_recent_source
  from public.kiosk_enrollment_attempts
  where source_hash = p_source_hash
    and outcome in ('rejected', 'rate_limited')
    and created_at > now() - interval '10 minutes';

  if v_pairing.id is not null then
    select count(*) into v_recent_station
    from public.kiosk_enrollment_attempts
    where station_id = v_pairing.station_id
      and outcome in ('rejected', 'rate_limited')
      and created_at > now() - interval '10 minutes';
  end if;

  -- Progressive quiet period: 2, 5, 15, then 60 seconds. The sixth failed
  -- request in ten minutes is rejected regardless of delay. We deliberately
  -- return one stable error rather than disclose whether a code exists.
  v_delay_seconds := case least(v_recent_device, 4)
    when 0 then 0 when 1 then 2 when 2 then 5 when 3 then 15 else 60 end;
  if v_recent_device >= 5 or v_recent_source >= 5 or v_recent_station >= 5
     or (v_delay_seconds > 0 and v_last_failure > now() - make_interval(secs => v_delay_seconds)) then
    insert into public.kiosk_enrollment_attempts(
      device_public_id, source_hash, station_id, pairing_code_hash, outcome
    ) values (
      p_device_public_id, p_source_hash, v_pairing.station_id, p_code_hash, 'rate_limited'
    );
    if v_pairing.id is not null then
      update public.kiosk_pairing_codes
      set failed_attempt_count = failed_attempt_count + 1,
          last_failed_attempt_at = now()
      where id = v_pairing.id;
    end if;
    return jsonb_build_object('ok', false, 'error', 'TOO_MANY_ENROLLMENT_ATTEMPTS');
  end if;

  if v_pairing.id is null
     or v_pairing.used_at is not null
     or v_pairing.expires_at <= now()
     or v_pairing.organization_id is null then
    insert into public.kiosk_enrollment_attempts(
      device_public_id, source_hash, station_id, pairing_code_hash, outcome
    ) values (
      p_device_public_id, p_source_hash, v_pairing.station_id, p_code_hash, 'rejected'
    );
    if v_pairing.id is not null then
      update public.kiosk_pairing_codes
      set failed_attempt_count = failed_attempt_count + 1,
          last_failed_attempt_at = now()
      where id = v_pairing.id;
    end if;
    return jsonb_build_object('ok', false, 'error', 'PAIRING_CODE_INVALID_OR_EXPIRED');
  end if;

  select * into v_device
  from public.kiosk_devices
  where device_public_id = p_device_public_id
  for update;

  if found then
    if v_device.station_id <> v_pairing.station_id
       or v_device.organization_id is distinct from v_pairing.organization_id then
      insert into public.kiosk_enrollment_attempts(
        device_public_id, source_hash, station_id, pairing_code_hash, outcome
      ) values (
        p_device_public_id, p_source_hash, v_pairing.station_id, p_code_hash, 'rejected'
      );
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

  insert into public.kiosk_enrollment_attempts(
    device_public_id, source_hash, station_id, pairing_code_hash, outcome
  ) values (
    p_device_public_id, p_source_hash, v_pairing.station_id, p_code_hash, 'accepted'
  );

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

revoke execute on function public.redeem_kiosk_pairing_code(text, text, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.redeem_kiosk_pairing_code(text, text, uuid, text, text)
  to service_role;

-- Keep the historical server-only signature temporarily for a zero-downtime
-- rollout. Browser roles are still denied; the new Edge Function uses the
-- five-argument function with a keyed source hash.
create or replace function public.redeem_kiosk_pairing_code(
  p_code_hash text,
  p_token_hash text,
  p_device_public_id uuid,
  p_app_version text
) returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.redeem_kiosk_pairing_code(
    p_code_hash,
    p_token_hash,
    p_device_public_id,
    p_app_version,
    lpad(md5(p_device_public_id::text), 64, '0')
  );
$$;

revoke execute on function public.redeem_kiosk_pairing_code(text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.redeem_kiosk_pairing_code(text, text, uuid, text)
  to service_role;
