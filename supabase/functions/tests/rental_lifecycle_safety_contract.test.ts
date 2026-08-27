import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const ejectSource = await Deno.readTextFile("supabase/functions/eject-after-payment/index.ts");
const callbackSource = await Deno.readTextFile("supabase/functions/chargenow-rent-callback/index.ts");
const cabinetEventSource = await Deno.readTextFile("supabase/functions/cabinet-event-push/index.ts");
const adminSource = await Deno.readTextFile("supabase/functions/rental-admin-action/index.ts");
const refundSource = await Deno.readTextFile("supabase/functions/_shared/stripeRefundRuntime.ts");

Deno.test("uncertain ejection results never trigger automatic retry or refund", () => {
  assert(ejectSource.includes("O2_PROVIDER_RESULT_AMBIGUOUS"));
  assert(ejectSource.includes("aucune seconde commande ne sera envoyée"));
  assert(ejectSource.includes("noSecondHardwareCommand: true"));
  assert(ejectSource.includes('new URL(`${BASE}/rent/order/create`)'));
  assert(ejectSource.includes("fetch(endpoint.toString()"));
  assertEquals(ejectSource.includes("automatic_refund"), false);
});

Deno.test("ChargeNow release callbacks require exact battery identity", () => {
  assert(callbackSource.includes("RELEASE_IDENTITY_INCOMPLETE"));
  assert(callbackSource.includes("RELEASE_RESERVATION_MISMATCH"));
  assert(callbackSource.includes("verifyCallback"));
  assert(callbackSource.includes('eventType: "battery_released"'));
  assert(callbackSource.includes('eventType: "rental_activated"'));
  assertEquals(callbackSource.includes('eventType: "rental_failed"'), false);
});

Deno.test("legacy BATTERY_IN events cannot select the latest station rental", () => {
  assertEquals(cabinetEventSource.includes('order("created_at", { ascending: false })'), false);
  assertEquals(cabinetEventSource.includes("delegateBatteryReturn"), true);
  assertEquals(cabinetEventSource.includes('eq("apifox_trade_no", tradeNo)'), true);
  assertEquals(cabinetEventSource.includes('eq("battery_id", batteryId)'), true);
  assertEquals(cabinetEventSource.includes("RETURN_IDENTITY_INCOMPLETE"), true);
});

Deno.test("non-return remains an explicit super-admin decision", () => {
  assert(adminSource.includes('action === "declare_non_return"'));
  assert(adminSource.includes("FORBIDDEN_SUPER_ADMIN_REQUIRED"));
  assert(adminSource.includes("non_return_declared_at"));
  assert(adminSource.includes('eventType: "non_return_declared"'));
  assertEquals(adminSource.includes("setTimeout("), false);
  assertEquals(adminSource.includes("cron"), false);
});

Deno.test("administrative return reconciliation requires battery, station and slot", () => {
  assert(adminSource.includes("RETURN_IDENTITY_INCOMPLETE"));
  assert(adminSource.includes("RETURN_BATTERY_MISMATCH"));
  assert(adminSource.includes("returnStationId"));
  assert(adminSource.includes("slotNum"));
});

Deno.test("administrative refunds derive replay state from Stripe", () => {
  assert(adminSource.includes("refundPaymentIntentBalance"));
  assert(refundSource.includes("currentRefunds"));
  assert(refundSource.includes("Replaying after a database failure"));
  assertEquals(refundSource.includes("refundedCents +="), false);
});
