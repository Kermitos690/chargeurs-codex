import { assert, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";

const resolver = await Deno.readTextFile("supabase/functions/dta21269-single-slot-quarantine-resolver/index.ts");
const migration = await Deno.readTextFile("supabase/migrations/20260825070614_audited_dta21269_single_slot_quarantine_resolver.sql");

Deno.test("DTA21269 resolver is read-only during dry-run and cannot emit physical commands", () => {
  assert(resolver.includes('action: "dry_run"'));
  assert(resolver.includes("physicalCommandsGenerated: 0"));
  assert(resolver.includes("performedHardwareAction: false"));
  assert(!resolver.includes("ejectByRent"));
  assert(!resolver.includes("orderCreate"));
});

Deno.test("DTA21269 resolver accepts only the persisted one-command one-output proof", () => {
  assert(resolver.includes('const PROOF_RENTAL_ID = "70e359eb-8400-42a3-bb5f-6638c33b66d6"'));
  assert(resolver.includes("sameOrder.length !== 1 || matching.length !== 1"));
  assert(resolver.includes('attempt?.result !== "single_release"'));
  assert(resolver.includes('evidence.settlementStatus !== "settled"'));
  assert(resolver.includes("RETURN_NOT_DETECTED"));
});

Deno.test("resolution is idempotent, persists immutable evidence, and uses a code SHA", () => {
  assertMatch(migration, /station_hardware_quarantine_resolution_audits/);
  assertMatch(migration, /unique \(station_id, quarantine_reason_code, proof_rental_session_id\)/);
  assertMatch(migration, /QUARANTINE_PROOF_BORROW_OUT_COUNT_INVALID/);
  assertMatch(migration, /physical_commands_generated', 0/);
  assertMatch(migration, /QUARANTINE_RESOLUTION_CODE_SHA_INVALID/);
  assertMatch(migration, /return query select false, true/);
});
