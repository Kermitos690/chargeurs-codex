import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const callbackSource = await Deno.readTextFile(
  new URL("../chargenow-rent-callback/index.ts", import.meta.url),
);

Deno.test("ChargeNow status=2 cannot synthesize a physical return timestamp", () => {
  assert(
    !callbackSource.includes("physical?.receivedAt ?? new Date().toISOString()"),
    "provider return evidence must never synthesize returned_at when physical BATTERY_IN evidence is missing",
  );
});

Deno.test("missing physical evidence exits before rental return mutation and settlement", () => {
  const physicalLookup = callbackSource.indexOf("const physical = await physicalReturnTime");
  const missingGuard = callbackSource.indexOf("if (!physical)", physicalLookup);
  const guardReturn = callbackSource.indexOf("physical_reconciliation_required: true", missingGuard);
  const returnedAt = callbackSource.indexOf("const returnedAt = physical.receivedAt", missingGuard);
  const returnedMutation = callbackSource.indexOf('state: "battery_returned"', returnedAt);
  const settlement = callbackSource.indexOf("const settlement = await triggerSettlement", returnedMutation);

  assert(physicalLookup >= 0, "physical return lookup must exist");
  assert(missingGuard > physicalLookup, "missing-evidence guard must follow physical lookup");
  assert(guardReturn > missingGuard, "missing-evidence path must explicitly request physical reconciliation");
  assert(returnedAt > guardReturn, "physical timestamp must only be consumed after the missing-evidence guard");
  assert(returnedMutation > returnedAt, "battery_returned mutation must happen only after physical evidence");
  assert(settlement > returnedMutation, "settlement must happen only after the physical return mutation");
});

Deno.test("missing physical evidence remains fail-closed for settlement", () => {
  const guardStart = callbackSource.indexOf("if (!physical)");
  const guardEnd = callbackSource.indexOf("const returnedAt = physical.receivedAt", guardStart);
  const guardBlock = callbackSource.slice(guardStart, guardEnd);

  assert(guardBlock.includes("RETURN_PHYSICAL_EVIDENCE_MISSING"));
  assert(guardBlock.includes("settlement_triggered: false"));
  assertEquals(guardBlock.includes("triggerSettlement("), false);
  assertEquals(guardBlock.includes('state: "battery_returned"'), false);
  assertEquals(guardBlock.includes('status: "in_station"'), false);
});
