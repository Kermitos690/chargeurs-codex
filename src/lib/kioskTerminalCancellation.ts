import type { NativeReaderProjection } from "@/lib/chargeursPresentationModel";

/**
 * The native runtime only exposes this terminal state after Stripe and the
 * server have both cancelled an unconfirmed PaymentIntent and released its
 * payment-rail claim. A UI tap or a local WisePad callback is not enough.
 */
export function hasServerConfirmedTerminalCancellation(reader: NativeReaderProjection | null): boolean {
  const payment = reader?.payment;
  return payment?.rail === "NONE"
    && (payment.railState === "CANCELLED" || payment.railState === "EXPIRED")
    && payment.serverConfirmed !== true
    && payment.recoveryRequired !== true;
}
