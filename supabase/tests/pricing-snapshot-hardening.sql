-- Run after applying all migrations to an isolated database.
-- The transaction is rolled back and leaves no fixture behind.

begin;

do $$
declare
  v_profile_id uuid;
  v_station_ref text := 'SNAPSHOT-TEST-' || replace(gen_random_uuid()::text, '-', '');
  v_version integer;
  v_history_count integer;
  v_distinct_versions integer;
  v_frozen jsonb;
begin
  if has_function_privilege(
    'anon',
    'public.compute_rental_pricing_snapshot(text,text,text,timestamptz,timestamptz,text,text,text)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.compute_rental_pricing_snapshot(text,text,text,timestamptz,timestamptz,text,text,text)',
    'EXECUTE'
  ) then
    raise exception 'FAIL browser role can execute compute_rental_pricing_snapshot';
  end if;

  insert into public.price_profiles (
    name,
    amount,
    currency,
    version,
    active,
    is_default,
    initial_fee_cents,
    included_minutes,
    period_minutes,
    price_per_period_cents,
    grace_minutes,
    daily_cap_cents,
    total_cap_cents,
    max_amount_cents,
    deposit_cents,
    late_fee_cents,
    unreturned_fee_cents,
    unreturned_after_minutes,
    min_amount_cents,
    rounding,
    tax_percent
  ) values (
    'Snapshot hardening test',
    0.75,
    'CHF',
    99,
    true,
    false,
    0,
    0,
    30,
    75,
    0,
    1800,
    0,
    9900,
    3000,
    0,
    9900,
    0,
    0,
    'none',
    0
  ) returning id, version into v_profile_id, v_version;

  if v_version <> 1 then
    raise exception 'FAIL new price profile version is %, expected 1', v_version;
  end if;

  insert into public.price_assignments(scope, scope_ref, price_profile_id, active)
  values ('station', v_station_ref, v_profile_id, true);

  select public.compute_rental_pricing_snapshot(
    null,
    v_station_ref,
    null,
    now(),
    null,
    'created',
    'normal',
    'CHF'
  ) into v_frozen;

  if (v_frozen->>'pricing_rules_version')::integer <> 1
     or (v_frozen->>'price_per_period_cents')::integer <> 75
     or (v_frozen->>'deposit_cents')::integer <> 3000 then
    raise exception 'FAIL rental pricing snapshot is incomplete: %', v_frozen;
  end if;

  update public.price_profiles
  set price_per_period_cents = 975
  where id = v_profile_id;

  select version into v_version
  from public.price_profiles
  where id = v_profile_id;
  if v_version <> 2 then
    raise exception 'FAIL first update version is %, expected 2', v_version;
  end if;

  -- The already captured document remains authoritative even though the live
  -- profile now charges a different amount.
  if (v_frozen->>'price_per_period_cents')::integer <> 75 then
    raise exception 'FAIL frozen snapshot changed with live profile';
  end if;

  update public.price_profiles
  set daily_cap_cents = 2000
  where id = v_profile_id;

  select version into v_version
  from public.price_profiles
  where id = v_profile_id;
  if v_version <> 3 then
    raise exception 'FAIL second update version is %, expected 3', v_version;
  end if;

  select count(*), count(distinct version)
  into v_history_count, v_distinct_versions
  from public.price_profile_versions
  where price_profile_id = v_profile_id;

  if v_history_count <> 3 or v_distinct_versions <> 3 then
    raise exception 'FAIL version history count %, distinct %', v_history_count, v_distinct_versions;
  end if;

  begin
    insert into public.price_profile_versions(
      price_profile_id,
      version,
      snapshot
    ) values (
      v_profile_id,
      3,
      '{}'::jsonb
    );
    raise exception 'FAIL duplicate profile version accepted';
  exception when unique_violation then
    null;
  end;
end;
$$;

rollback;
