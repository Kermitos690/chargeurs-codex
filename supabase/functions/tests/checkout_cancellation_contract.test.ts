import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { stagingAuthorizationReleaseAllowed } from "../_shared/checkoutCancellation.ts";

const source = await Deno.readTextFile(new URL("../cancel-kiosk-checkout/index.ts", import.meta.url));

const safeAuthorization = {
  requested: true,
  confirmedNoHardwareRelease: true,
  confirmedTestAuthorizationRelease: true,
  recoveryReason: "operator_confirmed_no_hardware_release",
  intent: {
    status: "requires_capture",
    livemode: false,
    amount: 3000,
    amount_capturable: 3000,
    amount_received: 0,
    metadata: { rental_session_id: "rental-1", station_id: "DTA21269" },
  },
  expectedRentalSessionId: "rental-1",
  expectedStationId: "DTA21269",
  expectedAmountCents: 3000,
};

Deno.test("STAGING authorization release requires every explicit invariant", () => {
  assert(stagingAuthorizationReleaseAllowed(safeAuthorization));
  assertEquals(stagingAuthorizationReleaseAllowed({ ...safeAuthorization, requested: false }), false);
  assertEquals(stagingAuthorizationReleaseAllowed({ ...safeAuthorization, confirmedNoHardwareRelease: false }), false);
  assertEquals(stagingAuthorizationReleaseAllowed({ ...safeAuthorization, confirmedTestAuthorizationRelease: false }), false);
  assertEquals(stagingAuthorizationReleaseAllowed({ ...safeAuthorization, expectedAmountCents: 2999 }), false);
  assertEquals(stagingAuthorizationReleaseAllowed({
    ...safeAuthorization,
    intent: { ...safeAuthorization.intent, livemode: true },
  }), false);
  assertEquals(stagingAuthorizationReleaseAllowed({
    ...safeAuthorization,
    intent: { ...safeAuthorization.intent, amount_received: 1 },
  }), false);
  assertEquals(stagingAuthorizationReleaseAllowed({
    ...safeAuthorization,
    intent: { ...safeAuthorization.intent, metadata: { rental_session_id: "other", station_id: "DTA21269" } },
  }), false);
});

Deno.test("recovery endpoint verifies no hardware attempt and releases only QR claim after Stripe cancellation", () => {
  assert(source.includes('from("hardware_release_attempts")'));
  assert(source.includes('count !== 0'));
  assert(source.includes('stripe.paymentIntents.cancel(intent.id'));
  assert(source.includes('p_expected_rail: "qr_checkout"'));
  assert(source.includes('STAGING_OPERATOR_AUTHORIZATION_RELEASED_NO_EJECTION'));
  assert(source.indexOf('release_rental_payment_rail_claim') < source.indexOf('state: "expired"'));
  assertEquals(source.includes('eject-after-payment'), false);
  assertEquals(source.includes('chargenow-rent'), false);
});
