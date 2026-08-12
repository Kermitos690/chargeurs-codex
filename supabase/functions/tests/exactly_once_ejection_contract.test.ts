import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const migration = await Deno.readTextFile("supabase/migrations/20260812090000_hardware_intents_return_events_and_settlement_backoff.sql");
const ejectSource = await Deno.readTextFile("supabase/functions/eject-after-payment/index.ts");
const callbackSource = await Deno.readTextFile("supabase/functions/chargenow-rent-callback/index.ts");
const reconcileSource = await Deno.readTextFile("supabase/functions/reconcile-pending-ejection/index.ts");
const snapshotSource = await Deno.readTextFile("supabase/functions/kiosk-cabinet-snapshot/index.ts");

Deno.test("one persistent eject intent exists before the supplier mutation", () => {
  assert(migration.toLowerCase().includes("create table if not exists public.hardware_commands"));
  assert(migration.includes("UNIQUE (rental_session_id, command_type)"));
  const createIntentAt = ejectSource.indexOf("createEjectIntent(");
  const ejectAt = ejectSource.indexOf("ejectByRent(", createIntentAt);
  assert(createIntentAt >= 0 && ejectAt > createIntentAt);
  assert(ejectSource.includes("preflightSelectedSlot"));
  assert(ejectSource.includes("PRE_EJECTION_SLOT_NOT_OCCUPIED"));
});

Deno.test("provider acknowledgement cannot make a rental active", () => {
  const start = callbackSource.indexOf("async function applyReleaseSuccess");
  const end = callbackSource.indexOf("Deno.serve", start);
  const block = callbackSource.slice(start, end);
  assert(block.includes('state: "provider_acknowledged"'));
  assert(block.includes('state: "ejecting"'));
  assertEquals(block.includes('eventType: "battery_released"'), false);
  assertEquals(block.includes('eventType: "rental_activated"'), false);
  assert(block.includes("physical\n  // truth of the cabinet"));
});

Deno.test("only a read-only cabinet reconciliation can activate a release", () => {
  for (const source of [reconcileSource, snapshotSource]) {
    assert(source.includes('eventType: "battery_released"'));
    assert(source.includes('eventType: "rental_activated"'));
    assert(source.includes('state: "physically_confirmed"'));
    assertEquals(source.includes("ejectByRent("), false);
    assert(source.includes("release_provider_callback_received"));
  }
});

Deno.test("a second empty slot quarantines instead of activating the rental", () => {
  for (const source of [reconcileSource, snapshotSource]) {
    assert(source.includes("unexpectedEmptySlotsAfterEjection"));
    assert(source.includes("MULTIPLE_SLOT_CHANGE_AFTER_EJECTION"));
    assert(source.includes('state: "physical_ambiguity"'));
  }
});

Deno.test("a return business fact is deduplicated independently of a corrected slot", () => {
  assert(callbackSource.includes("const returnDedupKey = `return:${identity.tradeNo}:${identity.batteryId}`"));
  assertEquals(callbackSource.includes("return:${identity.tradeNo}:${identity.batteryId}:${identity.stationId}"), false);
});
