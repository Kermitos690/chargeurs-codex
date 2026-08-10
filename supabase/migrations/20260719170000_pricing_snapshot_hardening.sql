-- Immutable rental pricing and correct price-profile version history.
--
-- The original history trigger attempted to mutate NEW.version from an AFTER
-- trigger. PostgreSQL ignores those mutations for the stored parent row, so
-- repeated edits could record duplicate version numbers. This migration first
-- repairs existing history, then separates BEFORE preparation from AFTER audit.

drop trigger if exists trg_price_profile_version on public.price_profiles;
drop trigger if exists trg_price_profile_prepare_version on public.price_profiles;
drop trigger if exists trg_price_profile_record_version on public.price_profiles;
drop function if exists public.price_profile_version_snapshot();

-- Profiles created before the original history trigger have no baseline row.
-- Seed only those missing baselines; on a replay this INSERT is a no-op.
insert into public.price_profile_versions(
  price_profile_id,
  version,
  snapshot,
  changed_by,
  created_at
)
select
  profile.id,
  greatest(coalesce(profile.version, 1), 1),
  to_jsonb(profile),
  profile.updated_by,
  coalesce(profile.updated_at, profile.created_at, now())
from public.price_profiles profile
where not exists (
  select 1
  from public.price_profile_versions history
  where history.price_profile_id = profile.id
);

-- Preserve every historical snapshot while assigning a deterministic,
-- monotonic version to rows produced by the former broken trigger.
with ranked as (
  select
    id,
    row_number() over (
      partition by price_profile_id
      order by created_at, id
    )::integer as repaired_version
  from public.price_profile_versions
)
update public.price_profile_versions history
set version = ranked.repaired_version,
    snapshot = jsonb_set(
      history.snapshot,
      '{version}',
      to_jsonb(ranked.repaired_version),
      true
    )
from ranked
where history.id = ranked.id
  and (
    history.version is distinct from ranked.repaired_version
    or history.snapshot->>'version' is distinct from ranked.repaired_version::text
  );

with latest as (
  select price_profile_id, max(version)::integer as latest_version
  from public.price_profile_versions
  group by price_profile_id
)
update public.price_profiles profile
set version = greatest(1, latest.latest_version)
from latest
where profile.id = latest.price_profile_id
  and profile.version is distinct from greatest(1, latest.latest_version);

create unique index if not exists price_profile_versions_profile_version_uidx
  on public.price_profile_versions(price_profile_id, version);

create or replace function public.price_profile_prepare_version()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    -- Version numbers are system-owned. A caller cannot create version 99.
    new.version := 1;
  else
    new.version := greatest(coalesce(old.version, 0) + 1, 1);
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.price_profile_record_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.price_profile_versions(
    price_profile_id,
    version,
    snapshot,
    changed_by
  ) values (
    new.id,
    new.version,
    to_jsonb(new),
    new.updated_by
  );
  return new;
end;
$$;

create trigger trg_price_profile_prepare_version
before insert or update on public.price_profiles
for each row execute function public.price_profile_prepare_version();

create trigger trg_price_profile_record_version
after insert or update on public.price_profiles
for each row execute function public.price_profile_record_version();

-- Create one self-contained rental snapshot. compute_pricing remains the
-- authoritative resolver/calculator for a new quote; this wrapper freezes all
-- rule inputs needed for every later calculation into the same JSON document.
create or replace function public.compute_rental_pricing_snapshot(
  p_device text,
  p_station text,
  p_shop text,
  p_start timestamptz,
  p_end timestamptz,
  p_rental_state text,
  p_return_state text,
  p_currency text
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with computed as materialized (
    select public.compute_pricing(
      p_device,
      p_station,
      p_shop,
      p_start,
      p_end,
      p_rental_state,
      p_return_state,
      p_currency
    ) as quote
  )
  select computed.quote || jsonb_build_object(
    'pricing_rules_version', 1,
    'initial_fee_cents', profile.initial_fee_cents,
    'included_minutes', profile.included_minutes,
    'period_minutes', profile.period_minutes,
    'price_per_period_cents', profile.price_per_period_cents,
    'grace_minutes', profile.grace_minutes,
    'daily_cap_cents', profile.daily_cap_cents,
    'total_cap_cents', profile.total_cap_cents,
    'max_amount_cents', profile.max_amount_cents,
    'deposit_cents', profile.deposit_cents,
    'late_fee_cents', profile.late_fee_cents,
    'unreturned_fee_cents', profile.unreturned_fee_cents,
    'unreturned_after_minutes', profile.unreturned_after_minutes,
    'min_amount_cents', profile.min_amount_cents,
    'rounding', profile.rounding,
    'tax_percent', profile.tax_percent
  )
  from computed
  join public.price_profiles profile
    on profile.id = (computed.quote->>'profile_id')::uuid;
$$;

revoke all on function public.compute_rental_pricing_snapshot(
  text, text, text, timestamptz, timestamptz, text, text, text
) from public, anon, authenticated;
grant execute on function public.compute_rental_pricing_snapshot(
  text, text, text, timestamptz, timestamptz, text, text, text
) to service_role;

comment on function public.compute_rental_pricing_snapshot(
  text, text, text, timestamptz, timestamptz, text, text, text
) is 'Creates a complete immutable pricing-rules snapshot for one rental; service_role only.';
