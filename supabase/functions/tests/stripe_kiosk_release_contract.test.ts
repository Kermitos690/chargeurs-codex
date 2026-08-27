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
  const bindingAt = source.indexOf("session.kiosk_device_id ?? \"\") !== String(device.id)");
  const contractAt = source.indexOf("CONTRACT_ACCEPTANCE_REQUIRED");
  const cachedUrlAt = source.indexOf("if (session.stripe_checkout_session_id)");
  const stripeCreateAt = source.indexOf("stripe.checkout.sessions.create");
  assert(authAt >= 0);
  assert(bindingAt > authAt);
  assert(contractAt > bindingAt);
  assert(contractAt < cachedUrlAt);
  assert(cachedUrlAt > bindingAt);
  assert(stripeCreateAt > bindingAt);
  assert(source.includes("onConflict: \"stripe_session_id\""));
  assert(source.includes("x-kiosk-token"));
  assertEquals(source.includes("body.kioskToken"), false);
});

Deno.test("Checkout keeps the explicit card-hold and TWINT settlement strategies", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/create-stripe-checkout/index.ts",
  );
  assert(source.includes('payment_method_types: ["card", "twint"]'));
  assert(source.includes('payment_method_options: { card: { capture_method: "manual"'));
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

Deno.test("hardware release is O2 callback-only and needs physical proof before one command", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/eject-after-payment/index.ts",
  );
  assert(source.includes("O2_CALLBACK_ONLY_PHYSICAL_PROOF_MISSING"));
  assert(source.includes("RELEASE_BASELINE_MISSING_OR_MISMATCH"));
  assert(source.includes('state: "ejecting"'));
  assert(source.includes('endpoint", "/rent/order/create"'));
  assert(source.includes("noSecondHardwareCommand: true"));
  // C3 is queried only as negative qualification evidence; no C3 command is
  // constructed or sent by this release path.
  assert(source.includes('new URL(`${BASE}/rent/order/create`)'));
  assert(source.includes("fetch(endpoint.toString()"));
  assertEquals(source.includes("automatic_refund"), false);
});
