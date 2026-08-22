import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const ejectSource = await Deno.readTextFile("supabase/functions/eject-after-payment/index.ts");
const callbackSource = await Deno.readTextFile("supabase/functions/chargenow-rent-callback/index.ts");
const cabinetEventSource = await Deno.readTextFile("supabase/functions/cabinet-event-push/index.ts");
const adminSource = await Deno.readTextFile("supabase/functions/rental-admin-action/index.ts");
const refundSource = await Deno.readTextFile("supabase/functions/_shared/stripeRefundRuntime.ts");

Deno.test("uncertain ejection results never trigger automatic retry or refund", () => {
  assert(ejectSource.includes("hardwareCommandIssued = true"));
  assert(ejectSource.includes("EJECTION_RECONCILIATION_REQUIRED"));
  assert(ejectSource.includes("Aucun retry ou remboursement automatique"));
  assert(ejectSource.includes('state: "eject_failed"'));
});

Deno.test("ChargeNow release callbacks never activate a rental without physical reconciliation", () => {
  assert(callbackSource.includes("RELEASE_PROVIDER_NOTIFICATION_ONLY"));
  assert(callbackSource.includes("requires_physical_reconciliation: true"));
  assertEquals(callbackSource.includes("confirmProviderRelease("), false);
  assertEquals(callbackSource.includes('eventType: "battery_released"'), false);
  assertEquals(callbackSource.includes('eventType: "rental_activated"'), false);
});

Deno.test("customer ejection is blocked until the supplier proves a single-slot contract", () => {
  assert(ejectSource.includes("hasVerifiedSingleSlotRentalContract"));
  assert(ejectSource.includes("SUPPLIER_SINGLE_SLOT_RENTAL_CONTRACT_UNVERIFIED"));
  assert(ejectSource.indexOf("SUPPLIER_SINGLE_SLOT_RENTAL_CONTRACT_UNVERIFIED") < ejectSource.indexOf("orderCreate({ deviceId"));
  assert(ejectSource.includes("requiresPhysicalReconciliation: true"));
  assert(cabinetEventSource.includes("DIRECT_BORROW_OUT_ACTIVATION_ENABLED = false"));
  assert(cabinetEventSource.includes("AWAITING_COMPLETE_PHYSICAL_RECONCILIATION"));
});

Deno.test("ChargeNow return settlement requires contractual BATTERY_IN evidence", () => {
  assert(callbackSource.includes("RETURN_IDENTITY_INCOMPLETE"));
  assert(callbackSource.includes("RETURN_PHYSICAL_EVIDENCE_MISSING"));
  assert(callbackSource.includes("contractualBatteryId"));
  assert(callbackSource.includes("returnedSlotNum"));
  assertEquals(callbackSource.includes("physical?.receivedAt ?? new Date().toISOString()"), false);
  assertEquals(callbackSource.includes("observedSlot === slotNum"), false);
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

Deno.test("an unlinked Checkout authorization is cancelled only after no-command hardware verification", () => {
  assert(adminSource.includes("cancelVerifiedUnlinkedTestAuthorization"));
  assert(adminSource.includes("assertNoPhysicalReleaseEvidence"));
  assert(adminSource.includes('attempt.result !== "prepared"'));
  assert(adminSource.includes("attempt.command_sent_at"));
  assert(adminSource.includes("releasedSlots.length > 0"));
  assert(adminSource.includes("checkout.client_reference_id"));
  assert(adminSource.includes("stagingAuthorizationReleaseAllowed"));
  assert(adminSource.includes('p_expected_rail: "qr_checkout"'));
  assert(adminSource.includes("staging_admin_authorization_released_no_ejection"));
  assert(adminSource.includes("stripe.test_authorization_released"));
});

Deno.test("a declined Terminal TEST attempt is canceled only after Stripe and physical checks", () => {
  assert(adminSource.includes("cancelVerifiedFailedTerminalTestAttempt"));
  assert(adminSource.includes('String(session.state ?? "") !== "payment_failed"'));
  assert(adminSource.includes('String(attempt?.status ?? "") !== "requires_payment_method"'));
  assert(adminSource.includes("intent.status === \"requires_payment_method\""));
  assert(adminSource.includes("Number(intent.amount_received) !== 0"));
  assert(adminSource.includes('String(metadata.payment_rail ?? "") !== "stripe_terminal"'));
  assert(adminSource.includes('p_expected_rail: "stripe_terminal"'));
  assert(adminSource.includes("stripe.terminal.test_attempt_cancelled"));
  assert(adminSource.includes("no_ejection: true"));
});
