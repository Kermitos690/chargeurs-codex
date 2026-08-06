import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { evaluateCheckoutKioskBinding } from "../create-stripe-checkout/kioskBinding.ts";

const SESSION = {
  station_id: "DTA21269",
  kiosk_device_id: "kiosk-1",
  state: "created",
};
const DEVICE = { id: "kiosk-1", station_id: "DTA21269" };

Deno.test("Checkout binding accepts only the exact kiosk and station", () => {
  assertEquals(evaluateCheckoutKioskBinding(SESSION, DEVICE), {
    ok: true,
    stationId: "DTA21269",
    kioskDeviceId: "kiosk-1",
  });
});

Deno.test("Checkout binding refuses an inter-station kiosk", () => {
  assertEquals(
    evaluateCheckoutKioskBinding(SESSION, {
      ...DEVICE,
      station_id: "DTA21277",
    }),
    { ok: false, status: 403, error: "KIOSK_STATION_MISMATCH" },
  );
});

Deno.test("Checkout binding refuses a different kiosk on the same station", () => {
  assertEquals(
    evaluateCheckoutKioskBinding(SESSION, { ...DEVICE, id: "kiosk-2" }),
    { ok: false, status: 403, error: "KIOSK_SESSION_MISMATCH" },
  );
});

Deno.test("Checkout binding refuses a paid or terminal rental", () => {
  assertEquals(
    evaluateCheckoutKioskBinding(
      { ...SESSION, state: "payment_succeeded" },
      DEVICE,
    ),
    { ok: false, status: 409, error: "SESSION_NOT_PAYABLE" },
  );
  assertEquals(
    evaluateCheckoutKioskBinding(
      { ...SESSION, state: "needs_support" },
      DEVICE,
    ),
    { ok: false, status: 409, error: "SESSION_NOT_PAYABLE" },
  );
});

Deno.test("Checkout endpoint authenticates before disclosing or creating a Checkout URL", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/create-stripe-checkout/index.ts",
  );
  const authAt = source.indexOf("await verifyKioskDevice(req, db, stationId)");
  const bindingAt = source.indexOf(
    "evaluateCheckoutKioskBinding(session, kioskAuth.device)",
  );
  const cachedUrlAt = source.indexOf("session.checkout_url &&");
  const stripeCreateAt = source.indexOf("stripe.checkout.sessions.create");
  assert(authAt >= 0);
  assert(bindingAt > authAt);
  assert(cachedUrlAt > bindingAt);
  assert(stripeCreateAt > bindingAt);
  const cachedPaymentRepairAt = source.indexOf("cachedPaymentError");
  assert(cachedPaymentRepairAt > cachedUrlAt);
  assert(cachedPaymentRepairAt < stripeCreateAt);
  assert(source.includes("onConflict: \"stripe_session_id\""));
  assert(source.includes("x-kiosk-token"));
  assertEquals(source.includes("body.kioskToken"), false);
});

Deno.test("Checkout keeps dynamic payment methods on one prepaid/refund strategy", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/create-stripe-checkout/index.ts",
  );
  assertEquals(source.includes("payment_method_types:"), false);
  assertEquals(source.includes("payment_method_options:"), false);
  assertEquals(source.includes('capture_method: "manual"'), false);
  assert(source.includes("rental_deposit_checkout:v2:"));
  assert(source.includes('settlement_strategy: "prepaid_refund"'));
});

Deno.test("Stripe Checkout payment upsert has a non-partial database conflict target", async () => {
  const migration = await Deno.readTextFile(
    "supabase/migrations/20260806000811_restore_payments_stripe_session_index.sql",
  );
  assert(migration.includes("ADD CONSTRAINT payments_stripe_session_id_key UNIQUE (stripe_session_id)"));
  assertEquals(migration.includes("WHERE stripe_session_id IS NOT NULL"), false);
});

Deno.test("disabled hardware is persisted as a terminal support state without automatic refund", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/eject-after-payment/index.ts",
  );
  const migration = await Deno.readTextFile(
    "supabase/migrations/20260806000812_add_one_time_rental_ejection_permits.sql",
  );
  const gateAt = source.indexOf("if (!areHardwareEjectionsEnabled() && !oneTimeTestResume)");
  const providerConfigAt = source.indexOf("if (!isChargeNowConfigured())");
  const hardwareAt = source.indexOf("hardwareCommandIssued = true");
  assert(gateAt >= 0);
  assert(providerConfigAt > gateAt);
  assert(hardwareAt > gateAt);
  assert(source.includes("await markHardwareReleaseBlocked(db, session)"));
  assert(source.includes('state: "needs_support"'));
  assert(source.includes("automatic_refund: false"));
  assert(source.includes("terminal: true"));
  assert(source.includes('eventType: "rental_failed"'));
  assert(source.includes("release_blocked:${session.id}:${code}"));
  // The permit is service-role-only, time limited and consumed atomically.
  assert(migration.includes("one_time_rental_ejection_permits"));
  assert(migration.toUpperCase().includes("ENABLE ROW LEVEL SECURITY"));
  assert(source.includes('chargeNowMode() === "test"'));
  assert(source.includes("permit.rental_session_id === session.id"));
  assert(source.includes("permit.slot_num === requestedSlotNum"));
  assert(source.includes("rental.one_time_test_ejection_consumed"));
  assert(source.includes("actor: \"one_time_ejection_permit\""));

  const disabledBranch = source.slice(gateAt, providerConfigAt);
  assertEquals(
    disabledBranch.includes("compensateBeforeHardwareRequest"),
    false,
  );
});
