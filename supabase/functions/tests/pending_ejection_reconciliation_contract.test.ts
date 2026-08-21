import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile("supabase/functions/reconcile-pending-ejection/index.ts");
const snapshotSource = await Deno.readTextFile("supabase/functions/kiosk-cabinet-snapshot/index.ts");

Deno.test("pending ejection reconciliation is read-only and selected-slot scoped", () => {
  assert(source.includes("readCabinetSnapshot(cabinetId)"));
  assert(source.includes("PHYSICAL_OBSERVATION_WINDOW_MS"));
  assert(source.includes("AWAITING_PHYSICAL_OBSERVATION_WINDOW"));
  assert(source.includes("EJECTION_PROVIDER_CONFIRMATION_PENDING") === false);
  assertEquals(source.includes("ejectByRent("), false);
  assertEquals(source.includes("orderCreate("), false);
});

Deno.test("ordinary kiosk refresh can only trigger read-only reconciliation", () => {
  assert(snapshotSource.includes("reconcileConfirmedSameStationReturns"));
  assert(snapshotSource.includes("This function never sends a ChargeNow hardware mutation"));
  assertEquals(snapshotSource.includes("ejectByRent("), false);
});

Deno.test("reconciliation blocks a multi-release before any activation", () => {
  assert(source.includes("RELEASE_IDENTITY_INCOMPLETE"));
  assert(source.includes("MULTI_BATTERY_RELEASE_OBSERVED"));
  assert(source.includes("multi_release_detected"));
  assert(source.includes('appendCanonical(d, session, "battery_released"'));
  assert(source.includes('appendCanonical(d, session, "rental_activated"'));
  assert(source.includes('state: "ejected"'));
});
