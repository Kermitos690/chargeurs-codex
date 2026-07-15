import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile("supabase/functions/sync-cabinet-status/index.ts");

Deno.test("cabinet synchronization accepts admins or a station-bound kiosk only", () => {
  assert(source.includes("requireAdmin"));
  assert(source.includes("verifyKioskDevice(req, db, stationId)"));
  assert(source.includes("KIOSK_STATION_REQUIRED"));
  assert(source.includes("if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status)"));
});

Deno.test("kiosk cabinet synchronization cannot request every station", () => {
  const kioskGuard = source.indexOf("if (!adminId)");
  const stationRequirement = source.indexOf("if (!stationId)", kioskGuard);
  const allStationsQuery = source.indexOf(": await query;", stationRequirement);
  assert(kioskGuard >= 0);
  assert(stationRequirement > kioskGuard);
  assert(allStationsQuery > stationRequirement);
});

Deno.test("expected provider failures return safe codes without secrets", () => {
  assert(source.includes("CHARGENOW_NOT_CONFIGURED"));
  assert(source.includes("CHARGENOW_UNREACHABLE"));
  assert(source.includes("INTERNAL_ERROR"));
  assertEquals(source.includes("CHARGENOW_BASIC_AUTH"), false);
  assertEquals(source.includes("CHARGENOW_BASIC_PASSWORD"), false);
});
