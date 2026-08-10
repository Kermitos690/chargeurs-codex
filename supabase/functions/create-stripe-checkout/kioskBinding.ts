export type CheckoutSessionBinding = {
  station_id?: unknown;
  kiosk_device_id?: unknown;
  state?: unknown;
};

export type CheckoutKioskDevice = {
  id: string;
  station_id: string;
};

export type CheckoutBindingDecision =
  | { ok: true; stationId: string; kioskDeviceId: string }
  | { ok: false; status: number; error: string };

const PAYABLE_STATES = new Set([
  "created",
  "checkout_created",
  "payment_pending",
]);

/**
 * Pure second-stage authorization for Checkout.
 *
 * `verifyKioskDevice` performs credential, revocation, expiry and station
 * checks. This guard additionally binds the rental itself to that exact kiosk
 * and rejects any non-payable lifecycle state before a Stripe object can be
 * created or an existing Checkout URL can be disclosed.
 */
export function evaluateCheckoutKioskBinding(
  session: CheckoutSessionBinding,
  device: CheckoutKioskDevice,
): CheckoutBindingDecision {
  const stationId = typeof session.station_id === "string"
    ? session.station_id.trim()
    : "";
  if (!stationId) {
    return { ok: false, status: 409, error: "SESSION_STATION_MISSING" };
  }
  if (device.station_id !== stationId) {
    return { ok: false, status: 403, error: "KIOSK_STATION_MISMATCH" };
  }

  const kioskDeviceId = typeof session.kiosk_device_id === "string"
    ? session.kiosk_device_id.trim()
    : "";
  if (!kioskDeviceId || kioskDeviceId !== device.id) {
    return { ok: false, status: 403, error: "KIOSK_SESSION_MISMATCH" };
  }

  if (!PAYABLE_STATES.has(String(session.state ?? ""))) {
    return { ok: false, status: 409, error: "SESSION_NOT_PAYABLE" };
  }

  return { ok: true, stationId, kioskDeviceId };
}
