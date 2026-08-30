export async function getStation(pool, stationId) {
  const result = await pool.query(
    `select station_id, cabinet_id, name, location_name, status, online,
            rentable_count, returnable_count, total_count, currency,
            price_per_period, last_sync_at, environment, is_pilot, pilot_enabled
       from stations
      where station_id = $1
      limit 1`,
    [stationId],
  );
  return result.rows[0] || null;
}

export async function getGuestQuote(pool, stationId) {
  const profileResult = await pool.query(
    `select id, name, currency, deposit_cents, total_cap_cents,
            unreturned_total_cents, unreturned_after_minutes,
            profile_version
       from pilot_pricing_profiles
      where active = true and (station_id = $1 or station_id is null)
      order by (station_id = $1) desc, updated_at desc
      limit 1`,
    [stationId],
  );
  const profile = profileResult.rows[0];
  if (!profile) return null;

  const tierResult = await pool.query(
    `select upper_minutes, total_cents
       from pilot_pricing_tiers
      where profile_id = $1
      order by upper_minutes asc`,
    [profile.id],
  );
  const tiers = tierResult.rows.map((row) => ({
    upper_minutes: Number(row.upper_minutes),
    total_cents: Number(row.total_cents),
  }));
  if (!tiers.length) return null;

  const first = tiers[0];
  const day = tiers.find((tier) => tier.upper_minutes === 1440) || tiers.at(-1);

  return {
    amount: first.total_cents / 100,
    currency: profile.currency,
    profile_name: profile.name,
    final_cents: first.total_cents,
    profile_id: profile.id,
    profile_version: Number(profile.profile_version || 1),
    source: "pilot_postgres:guest",
    deposit_cents: Number(profile.deposit_cents),
    period_minutes: Number(day.upper_minutes),
    price_per_period_cents: Number(day.total_cents),
    daily_cap_cents: 0,
    total_cap_cents: Number(profile.total_cap_cents),
    unreturned_fee_cents: Number(profile.unreturned_total_cents),
    unreturned_after_minutes: Number(profile.unreturned_after_minutes),
    tiered: true,
    tiers,
  };
}
