export type KioskPaymentPresentation = {
  phase: "waitpay" | "error" | "support" | "expired";
  titleKey: string;
  subtitleKey: string;
};

/*
 * IMPORTANT P0 safety rule
 * ------------------------
 * Hardware/manual-review states must NOT leave the authoritative session
 * polling loop. Kiosk.tsx polls while in `waitpay`, but historically stopped
 * polling as soon as the presentation phase became `support`. That produced the
 * unsafe physical state where the UI said "Une vérification est en cours" while
 * no verification was actually being observed anymore, and exposed a generic
 * "Recommencer" button capable of resetting the local journey.
 *
 * Support-like server states therefore reuse the protected `waitpay` runtime
 * while keeping their own support title/subtitle. Presentation styling is
 * applied separately by the P0 support scene guard. This preserves the same
 * rentalSessionId/publicCode and lets a later authoritative `ejected`,
 * `active_rental` or `battery_taken` transition resolve automatically.
 */
const FAILURE_PRESENTATION: Record<string, KioskPaymentPresentation> = {
  CHECKOUT_EXPIRED: { phase: "expired", titleKey: "kiosk.state.payment_expired.title", subtitleKey: "kiosk.state.payment_expired.subtitle" },
  ASYNC_PAYMENT_FAILED: { phase: "error", titleKey: "kiosk.state.payment_failed.title", subtitleKey: "kiosk.state.payment_failed.subtitle" },
  PAYMENT_INTENT_FAILED: { phase: "error", titleKey: "kiosk.state.payment_failed.title", subtitleKey: "kiosk.state.payment_failed.subtitle" },
  HARDWARE_EJECTION_DISABLED: { phase: "waitpay", titleKey: "kiosk.state.hardware_ejection_disabled.title", subtitleKey: "kiosk.state.hardware_ejection_disabled.subtitle" },
  BATTERY_ID_MISSING: { phase: "waitpay", titleKey: "kiosk.state.battery_id_missing.title", subtitleKey: "kiosk.state.battery_id_missing.subtitle" },
  BATTERY_CORRELATION_REQUIRED: { phase: "waitpay", titleKey: "kiosk.state.battery_id_missing.title", subtitleKey: "kiosk.state.battery_id_missing.subtitle" },
};

const STATE_PRESENTATION: Record<string, KioskPaymentPresentation> = {
  payment_succeeded: { phase: "waitpay", titleKey: "kiosk.state.payment_succeeded.title", subtitleKey: "kiosk.state.payment_succeeded.subtitle" },
  ejecting: { phase: "waitpay", titleKey: "kiosk.state.ejecting.title", subtitleKey: "kiosk.state.ejecting.subtitle" },
  payment_failed: { phase: "error", titleKey: "kiosk.state.payment_failed.title", subtitleKey: "kiosk.state.payment_failed.subtitle" },
  payment_expired: { phase: "expired", titleKey: "kiosk.state.payment_expired.title", subtitleKey: "kiosk.state.payment_expired.subtitle" },
  chargenow_failed: { phase: "waitpay", titleKey: "kiosk.state.chargenow_failed.title", subtitleKey: "kiosk.state.chargenow_failed.subtitle" },
  eject_failed: { phase: "waitpay", titleKey: "kiosk.state.eject_failed.title", subtitleKey: "kiosk.state.eject_failed.subtitle" },
  needs_support: { phase: "waitpay", titleKey: "kiosk.state.needs_support.title", subtitleKey: "kiosk.state.needs_support.subtitle" },
  manual_review: { phase: "waitpay", titleKey: "kiosk.state.manual_review.title", subtitleKey: "kiosk.state.manual_review.subtitle" },
  refunded: { phase: "error", titleKey: "kiosk.state.refunded.title", subtitleKey: "kiosk.state.refunded.subtitle" },
  payment_cancelled: { phase: "error", titleKey: "kiosk.state.payment_cancelled.title", subtitleKey: "kiosk.state.payment_cancelled.subtitle" },
  cancelled: { phase: "error", titleKey: "kiosk.state.cancelled.title", subtitleKey: "kiosk.state.cancelled.subtitle" },
};

/** Uses only the scoped, server-confirmed rental projection; never a redirect. */
export function kioskPaymentPresentation(state: string, failureCode?: string | null): KioskPaymentPresentation | null {
  if (failureCode && FAILURE_PRESENTATION[failureCode]) return FAILURE_PRESENTATION[failureCode];
  return STATE_PRESENTATION[state] ?? null;
}
