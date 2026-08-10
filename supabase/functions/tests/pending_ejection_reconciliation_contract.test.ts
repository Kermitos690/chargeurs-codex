import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile("supabase/functions/reconcile-pending-ejection/index.ts");
const snapshotSource = await Deno.readTextFile("supabase/functions/kiosk-cabinet-snapshot/index.ts");

Deno.test("pending ejection reconciliation is read-only and selected-slot scoped", () => {
  assert(source.includes("readCabinetSnapshot(cabinetId)"));
  assert(source.includes("item.slot_num === slotNum"));
  assert(source.includes("slot.battery_present !== false"));
  assert(source.includes("EJECTION_PROVIDER_CONFIRMATION_PENDING") === false);
  assertEquals(source.includes("ejectByRent("), false);
  assertEquals(source.includes("orderCreate("), false);
});

Deno.test("ordinary kiosk refresh only reconciles a recent exact empty slot", () => {
  assert(snapshotSource.includes("reconcileRecentPendingRelease"));
  assert(snapshotSource.includes("15 * 60 * 1000"));
  assert(snapshotSource.includes("slot?.battery_present !== false"));
  assertEquals(snapshotSource.includes("ejectByRent("), false);
});

Deno.test("reconciliation requires the reservation identity before activation", () => {
  assert(source.includes("RELEASE_IDENTITY_INCOMPLETE"));
  assert(source.includes('eventType: "battery_released"'));
  assert(source.includes('eventType: "rental_activated"'));
  assert(source.includes('state: "ejected"'));
});
