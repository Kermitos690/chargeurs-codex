import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const migrationPath = "supabase/migrations/20260815070553_kiosk_guest_deposit_contract.sql";

Deno.test("Guest beta gate and frontend guard agree on the CHF 30 guarantee", async () => {
  const [migration, guard] = await Promise.all([
    Deno.readTextFile(migrationPath),
    Deno.readTextFile("src/lib/kioskFetch.ts"),
  ]);

  assert(migration.includes("coalesce(v_profile.deposit_cents, -1) <> 3000"));
  assert(migration.includes("coalesce(v_profile.total_cap_cents, -1) <> 2990"));
  assert(migration.includes("coalesce(v_profile.price_per_period_cents, -1) <> 790"));
  assert(migration.includes("(30, 190)"));
  assert(migration.includes("(1440, 790)"));
  assertEquals(guard.includes("depositCents: 3_000"), true);
  assertEquals(guard.includes("totalCapCents: 2_990"), true);
});
