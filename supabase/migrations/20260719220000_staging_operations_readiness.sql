-- Operational metadata and organization-bound kiosk enrollment.
-- This migration is additive and safe for existing staging data.

insert into public.organizations (slug, legal_name, kind, status, metadata)
values ('chargeurs-ch', 'Chargeurs.ch', 'platform', 'active', '{"owner":true}'::jsonb)
on conflict (slug) do update
set legal_name = excluded.legal_name,
    kind = excluded.kind,
    status = excluded.status,
    updated_at = now();

alter table public.stations
  add column if not exists organization_id uuid references public.organizations(id) on delete restrict,
  add column if not exists environment text not null default 'staging'
    check (environment in ('local','test','staging','production')),
  add column if not exists is_pilot boolean not null default false,
  add column if not exists provider_shop_id text,
  add column if not exists provider_pricing jsonb,
  add column if not exists kiosk_url text;

create index if not exists stations_organization_environment_idx
  on public.stations(organization_id, environment, is_pilot);

alter table public.kiosk_devices
  add column if not exists organization_id uuid references public.organizations(id) on delete restrict;
alter table public.kiosk_pairing_codes
  add column if not exists organization_id uuid references public.organizations(id) on delete restrict;

update public.kiosk_devices device
set organization_id = station.organization_id
from public.stations station
where device.station_id = station.station_id
  and device.organization_id is null;

update public.kiosk_pairing_codes pairing
set organization_id = station.organization_id
from public.stations station
where pairing.station_id = station.station_id
  and pairing.organization_id is null;

create index if not exists kiosk_devices_organization_idx
  on public.kiosk_devices(organization_id, station_id);
create index if not exists kiosk_pairing_codes_organization_idx
  on public.kiosk_pairing_codes(organization_id, station_id, created_at desc);

alter table public.organization_memberships
  drop constraint if exists organization_memberships_partner_role;
alter table public.organization_memberships
  drop constraint if exists organization_memberships_allowed_role;
alter table public.organization_memberships
  add constraint organization_memberships_allowed_role check (
    role::text in ('super_admin','admin','operations_admin','partner_owner','partner_staff')
  );

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

  if v_pairing.organization_id is null then
    return jsonb_build_object('ok', false, 'error', 'PAIRING_ORGANIZATION_MISSING');
  end if;

  if exists (
    select 1 from public.kiosk_devices
    where device_public_id = p_device_public_id and active = true and token_revoked = false
  ) then
    return jsonb_build_object('ok', false, 'error', 'DEVICE_ALREADY_ENROLLED');
  end if;

  insert into public.kiosk_devices (
    station_id, organization_id, label, token_hash, active, token_revoked,
    token_rotated_at, device_public_id, app_version, enrolled_at
  ) values (
    v_pairing.station_id, v_pairing.organization_id, v_pairing.label,
    p_token_hash, true, false, now(), p_device_public_id,
    left(coalesce(p_app_version, ''), 64), now()
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
      'organization_id', v_device.organization_id,
      'device_public_id', v_device.device_public_id,
      'app_version', v_device.app_version
    )
  );

  return jsonb_build_object(
    'ok', true,
    'device_id', v_device.id,
    'station_id', v_device.station_id,
    'organization_id', v_device.organization_id
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
