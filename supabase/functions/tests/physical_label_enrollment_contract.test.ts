import { assert, assertMatch, assertNotMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";

const migration = await Deno.readTextFile(
  new URL("../../migrations/20260814093000_battery_physical_label_enrollment.sql", import.meta.url),
);
const functionSource = await Deno.readTextFile(
  new URL("../dta-pilot-qualification/index.ts", import.meta.url),
);

Deno.test("physical labels are a private, one-to-one operational registry", () => {
  assertMatch(migration, /create table if not exists public\.battery_physical_labels/);
  assertMatch(migration, /'planned', 'operator_confirmed', 'superseded', 'voided'/);
  assertMatch(migration, /where verification_state = 'operator_confirmed'/);
  assertMatch(migration, /revoke all on public\.battery_physical_labels from public, anon, authenticated/);
  assertMatch(migration, /grant select, insert, update on public\.battery_physical_labels to service_role/);
});

Deno.test("a planned label has no implied provider battery identity", () => {
  const match = functionSource.match(/if \(action === "reserve_physical_label"\) \{([\s\S]*?)\n    \}\n\n    if \(action === "assign_physical_label"\)/);
  if (!match) throw new Error("physical label reservation action not found");
  const action = match[1];
  assertMatch(action, /verification_state: "planned"/);
  assertNotMatch(action, /battery_id:/);
  assertNotMatch(action, /cabinetQuery|ejectByRent|rental_sessions|payments|settle/);
});

Deno.test("a label can only be assigned after exact in-station detection", () => {
  const match = functionSource.match(/if \(action === "assign_physical_label"\) \{([\s\S]*?)\n    \}\n\n    const station/);
  if (!match) throw new Error("physical label action not found");
  const action = match[1];
  assertMatch(action, /BATTERY_MUST_BE_DETECTED_IN_DTA21269/);
  assertMatch(action, /battery\.station_id !== DTA_PILOT_STATION_ID/);
  assertMatch(action, /battery\.status !== "in_station"/);
  assertMatch(action, /PHYSICAL_LABEL_ALREADY_ASSIGNED/);
  assertMatch(action, /BATTERY_ALREADY_HAS_PHYSICAL_LABEL/);
  assertNotMatch(action, /ejectByRent|orderCreate|cabinetQuery|rental_sessions|payments|settle/);
});
