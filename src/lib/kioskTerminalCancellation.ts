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

// A cancellation may originate either from the kiosk button or from the
// WisePad STOP control. Both must leave the payment screen only after the
// native bridge reports the same server-confirmed terminal-rail release.
export function shouldLeaveTerminalPaymentStage(
  reader: NativeReaderProjection | null,
  cancellationAlreadyHandled: boolean,
): boolean {
  return !cancellationAlreadyHandled && hasServerConfirmedTerminalCancellation(reader);
}
