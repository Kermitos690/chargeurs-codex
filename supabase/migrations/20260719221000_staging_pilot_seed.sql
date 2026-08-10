-- Idempotent staging baseline. Provider status and inventory remain unknown
-- until a successful read-only ChargeNow synchronization replaces them.

do $$
declare
  v_organization_id uuid;
  v_profile_id uuid;
begin
  select id into v_organization_id
  from public.organizations
  where slug = 'chargeurs-ch';

  if v_organization_id is null then
    raise exception 'Chargeurs.ch organization is missing';
  end if;

  insert into public.stations (
    station_id, cabinet_id, name, status, online, rentable_count,
    returnable_count, total_count, currency, price_per_period,
    organization_id, environment, is_pilot, kiosk_url
  ) values
    (
      'DTA21269', 'DTA21269', 'Chargeurs.ch — Borne pilote DTA21269',
      'unknown', false, 0, 0, 0, 'CHF', 0.75,
      v_organization_id, 'staging', true,
      'https://chargeurs-ch-staging.vercel.app/kiosk/DTA21269'
    ),
    (
      'DTA21277', 'DTA21277', 'Chargeurs.ch — Borne DTA21277',
      'unknown', false, 0, 0, 0, 'CHF', 0.75,
      v_organization_id, 'staging', false,
      'https://chargeurs-ch-staging.vercel.app/kiosk/DTA21277'
    ),
    (
      'DTA22032', 'DTA22032', 'Chargeurs.ch — Borne DTA22032',
      'unknown', false, 0, 0, 0, 'CHF', 0.75,
      v_organization_id, 'staging', false,
      'https://chargeurs-ch-staging.vercel.app/kiosk/DTA22032'
    )
  on conflict (station_id) do update
  set cabinet_id = excluded.cabinet_id,
      name = excluded.name,
      currency = excluded.currency,
      price_per_period = excluded.price_per_period,
      organization_id = excluded.organization_id,
      environment = excluded.environment,
      is_pilot = excluded.is_pilot,
      kiosk_url = excluded.kiosk_url;

  -- Remove only the historical demo inventory. A real provider sync always
  -- sets last_sync_at and/or raw_data and is therefore never overwritten here.
  update public.stations
  set location_name = null,
      status = 'unknown',
      online = false,
      signal = null,
      rentable_count = 0,
      returnable_count = 0,
      total_count = 0
  where station_id in ('DTA21269', 'DTA21277', 'DTA22032')
    and last_sync_at is null
    and raw_data is null;

  insert into public.kiosk_settings (key, value)
  values ('simulation_mode', '{"enabled":false}'::jsonb)
  on conflict (key) do update
  set value = excluded.value,
      updated_at = now();

  select id into v_profile_id
  from public.price_profiles
  where name = 'Chargeurs.ch Pilote'
  order by created_at
  limit 1;

  if v_profile_id is null then
    insert into public.price_profiles (
      name, description, amount, currency, period_label, is_default, active,
      priority, initial_fee_cents, included_minutes, period_minutes,
      price_per_period_cents, grace_minutes, daily_cap_cents,
      total_cap_cents, max_amount_cents, deposit_cents, late_fee_cents,
      unreturned_fee_cents, unreturned_after_minutes, min_amount_cents,
      rounding, tax_percent
    ) values (
      'Chargeurs.ch Pilote',
      'Tarif staging : 1,50 CHF/heure, incréments de 30 minutes.',
      0.75, 'CHF', 'par 30 min', true, true,
      100, 0, 0, 30,
      75, 0, 1800,
      0, 9900, 3000, 0,
      9900, 0, 0,
      'none', 0
    ) returning id into v_profile_id;
  else
    update public.price_profiles
    set description = 'Tarif staging : 1,50 CHF/heure, incréments de 30 minutes.',
        amount = 0.75,
        currency = 'CHF',
        period_label = 'par 30 min',
        is_default = true,
        active = true,
        priority = 100,
        initial_fee_cents = 0,
        included_minutes = 0,
        period_minutes = 30,
        price_per_period_cents = 75,
        grace_minutes = 0,
        daily_cap_cents = 1800,
        total_cap_cents = 0,
        max_amount_cents = 9900,
        deposit_cents = 3000,
        late_fee_cents = 0,
        unreturned_fee_cents = 9900,
        unreturned_after_minutes = 0,
        min_amount_cents = 0,
        rounding = 'none',
        tax_percent = 0
    where id = v_profile_id
      and (
        amount, currency, period_minutes, price_per_period_cents,
        daily_cap_cents, max_amount_cents, deposit_cents,
        unreturned_fee_cents, is_default, active
      ) is distinct from (
        0.75::numeric, 'CHF'::text, 30, 75,
        1800, 9900, 3000, 9900, true, true
      );
  end if;

  update public.price_profiles
  set is_default = false
  where id <> v_profile_id and is_default = true;

  update public.price_assignments
  set active = false,
      updated_at = now()
  where scope = 'station'
    and scope_ref = 'DTA21269'
    and active = true
    and price_profile_id <> v_profile_id;

  if not exists (
    select 1 from public.price_assignments
    where scope = 'station'
      and scope_ref = 'DTA21269'
      and price_profile_id = v_profile_id
      and active = true
  ) then
    insert into public.price_assignments (
      scope, scope_ref, price_profile_id, active
    ) values ('station', 'DTA21269', v_profile_id, true);
  end if;
end
$$;
