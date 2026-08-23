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
  const authAt = source.indexOf("const device = await auth(req, db, stationId)");
  const bindingAt = source.indexOf("String(session.kiosk_device_id ?? \"\") !== String(device.id)");
  const cachedUrlAt = source.indexOf("if (session.stripe_checkout_session_id)");
  const stripeCreateAt = source.indexOf("stripe.checkout.sessions.create");
  assert(authAt >= 0);
  assert(bindingAt > authAt);
  assert(cachedUrlAt > bindingAt);
  assert(stripeCreateAt > bindingAt);
  assert(source.includes("onConflict: \"stripe_session_id\""));
  assert(source.includes("x-kiosk-token"));
  assertEquals(source.includes("body.kioskToken"), false);
});

Deno.test("Checkout keeps the CHF 30 guarantee as card authorization or TWINT prepayment", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/create-stripe-checkout/index.ts",
  );
  assert(source.includes('payment_method_types: ["card", "twint"]'));
  assert(source.includes('payment_method_options: { card: { capture_method: "manual", setup_future_usage: "off_session" } }'));
  assert(source.includes('payment_purpose: "rental_guarantee"'));
  assert(source.includes("rental_direct_checkout:v8:"));
  assert(source.includes('card_capture: "manual", twint_capture: "automatic"'));
});

Deno.test("Stripe Checkout payment upsert has a non-partial database conflict target", async () => {
  const migration = await Deno.readTextFile(
    "supabase/migrations/20260806000811_restore_payments_stripe_session_index.sql",
  );
  assert(migration.includes("ADD CONSTRAINT payments_stripe_session_id_key UNIQUE (stripe_session_id)"));
  assertEquals(migration.includes("WHERE stripe_session_id IS NOT NULL"), false);
});

Deno.test("ChargeNow order projection has a real rental-session conflict target", async () => {
  const migration = await Deno.readTextFile(
    "supabase/migrations/20260806000813_restore_apifox_orders_rental_session_constraint.sql",
  );
  assert(/ADD CONSTRAINT\s+apifox_orders_rental_session_id_key\s+UNIQUE \(rental_session_id\)/i.test(migration));
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
  assert(source.includes("orderCreateWithOneTimeRentalPermit"));

  const disabledBranch = source.slice(gateAt, providerConfigAt);
  assertEquals(
    disabledBranch.includes("compensateBeforeHardwareRequest"),
    false,
  );
});
