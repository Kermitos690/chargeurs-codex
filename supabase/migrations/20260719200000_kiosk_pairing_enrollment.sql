-- One-time Android kiosk enrollment. Pairing codes are short lived, stored
-- only as SHA-256 hashes and redeemed atomically by the service-role function.

alter table public.kiosk_devices
  add column if not exists device_public_id uuid,
  add column if not exists app_version text,
  add column if not exists enrolled_at timestamptz,
  add column if not exists revoked_at timestamptz;

create unique index if not exists kiosk_devices_device_public_id_key
  on public.kiosk_devices(device_public_id)
  where device_public_id is not null;

create table if not exists public.kiosk_pairing_codes (
  id uuid primary key default gen_random_uuid(),
  station_id text not null,
  label text,
  code_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by_device_id uuid references public.kiosk_devices(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint kiosk_pairing_code_expiry_after_creation check (expires_at > created_at)
);

create index if not exists kiosk_pairing_codes_active_idx
  on public.kiosk_pairing_codes(code_hash, expires_at)
  where used_at is null;

alter table public.kiosk_pairing_codes enable row level security;
grant select, insert, update on public.kiosk_pairing_codes to authenticated;
grant all on public.kiosk_pairing_codes to service_role;

drop policy if exists "Admins manage kiosk pairing codes" on public.kiosk_pairing_codes;
create policy "Admins manage kiosk pairing codes"
  on public.kiosk_pairing_codes for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

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

  if exists (
    select 1 from public.kiosk_devices
    where device_public_id = p_device_public_id and active = true and token_revoked = false
  ) then
    return jsonb_build_object('ok', false, 'error', 'DEVICE_ALREADY_ENROLLED');
  end if;

  insert into public.kiosk_devices (
    station_id, label, token_hash, active, token_revoked,
    token_rotated_at, device_public_id, app_version, enrolled_at
  ) values (
    v_pairing.station_id, v_pairing.label, p_token_hash, true, false,
    now(), p_device_public_id, left(coalesce(p_app_version, ''), 64), now()
  ) returning * into v_device;

  update public.kiosk_pairing_codes
  set used_at = now(), used_by_device_id = v_device.id
  where id = v_pairing.id and used_at is null;

  insert into public.audit_logs(action, target, data)
  values (
    'kiosk.enrollment.redeemed',
    v_device.id::text,
    jsonb_build_object(
      'station_id', v_device.station_id,
      'device_public_id', v_device.device_public_id,
      'app_version', v_device.app_version
    )
  );

  return jsonb_build_object(
    'ok', true,
    'device_id', v_device.id,
    'station_id', v_device.station_id
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

-- Revocation timestamps are authoritative for operational and audit views.
create or replace function public.set_kiosk_revoked_at()
returns trigger language plpgsql set search_path = public as $$
begin
  if (new.token_revoked = true or new.active = false)
     and (old.token_revoked = false and old.active = true) then
    new.revoked_at := now();
  elsif new.token_revoked = false and new.active = true then
    new.revoked_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_kiosk_revoked_at on public.kiosk_devices;
create trigger trg_kiosk_revoked_at
before update on public.kiosk_devices
for each row execute function public.set_kiosk_revoked_at();

