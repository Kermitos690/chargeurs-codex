import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile("supabase/functions/reconcile-pending-ejection/index.ts");
const snapshotSource = await Deno.readTextFile("supabase/functions/kiosk-cabinet-snapshot/index.ts");

Deno.test("pending ejection reconciliation is read-only and physical-event driven", () => {
  assert(source.includes('eq("event_type", "BATTERY_BORROW_OUT")'));
  assert(source.includes("FIRST_RELEASE_SETTLE_MS"));
  assert(source.includes("AWAITING_FIRST_RELEASE_SETTLE_WINDOW"));
  assert(source.includes("PHYSICAL_SLOT_NOT_YET_EMPTY"));
  assertEquals(source.includes("ejectByRent("), false);
  assertEquals(source.includes("orderCreate("), false);
});

Deno.test("ordinary kiosk refresh never sends a ChargeNow hardware mutation", () => {
  assertEquals(snapshotSource.includes("ejectByRent("), false);
  assertEquals(snapshotSource.includes("orderCreate("), false);
});

Deno.test("multi-release is terminal before rental activation", () => {
  const multi = source.indexOf("MULTI_BATTERY_RELEASE_OBSERVED");
  const activate = source.indexOf('appendCanonical(db, actualSession, "battery_released"');
  assert(multi >= 0);
  assert(source.includes("multi_release_detected"));
  assert(activate > multi);
  assert(source.includes('state: "needs_support"'));
});

Deno.test("single release requires provider event, baseline battery and empty physical slot", () => {
  assert(source.includes("PROVIDER_RELEASE_NOT_IN_BASELINE"));
  assert(source.includes("PHYSICAL_SLOT_NOT_YET_EMPTY"));
  assert(source.includes('result: "single_release"'));
  assert(source.includes('source: "chargenow_event_plus_station_slots"'));
  assert(source.includes('appendCanonical(db, actualSession, "battery_released"'));
  assert(source.includes('appendCanonical(db, actualSession, "rental_activated"'));
});

Deno.test("reconciliation uses the canonical 36-character UUID validator", () => {
  assert(source.includes('import { isCanonicalUuid } from "../_shared/uuid.ts"'));
  assert(source.includes("!isCanonicalUuid(rentalSessionId)"));
  assertEquals(source.includes("[0-9a-f-]{27}"), false);
});
