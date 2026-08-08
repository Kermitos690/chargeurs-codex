export type KioskPaymentPresentation = {
  phase: "waitpay" | "error" | "support" | "expired";
  titleKey: string;
  subtitleKey: string;
};

const FAILURE_PRESENTATION: Record<string, KioskPaymentPresentation> = {
  CHECKOUT_EXPIRED: { phase: "expired", titleKey: "kiosk.state.payment_expired.title", subtitleKey: "kiosk.state.payment_expired.subtitle" },
  ASYNC_PAYMENT_FAILED: { phase: "error", titleKey: "kiosk.state.payment_failed.title", subtitleKey: "kiosk.state.payment_failed.subtitle" },
  PAYMENT_INTENT_FAILED: { phase: "error", titleKey: "kiosk.state.payment_failed.title", subtitleKey: "kiosk.state.payment_failed.subtitle" },
  HARDWARE_EJECTION_DISABLED: { phase: "support", titleKey: "kiosk.state.hardware_ejection_disabled.title", subtitleKey: "kiosk.state.hardware_ejection_disabled.subtitle" },
  BATTERY_ID_MISSING: { phase: "support", titleKey: "kiosk.state.battery_id_missing.title", subtitleKey: "kiosk.state.battery_id_missing.subtitle" },
  BATTERY_CORRELATION_REQUIRED: { phase: "support", titleKey: "kiosk.state.battery_id_missing.title", subtitleKey: "kiosk.state.battery_id_missing.subtitle" },
};

const STATE_PRESENTATION: Record<string, KioskPaymentPresentation> = {
  payment_succeeded: { phase: "waitpay", titleKey: "kiosk.state.payment_succeeded.title", subtitleKey: "kiosk.state.payment_succeeded.subtitle" },
  ejecting: { phase: "waitpay", titleKey: "kiosk.state.ejecting.title", subtitleKey: "kiosk.state.ejecting.subtitle" },
  payment_failed: { phase: "error", titleKey: "kiosk.state.payment_failed.title", subtitleKey: "kiosk.state.payment_failed.subtitle" },
  payment_expired: { phase: "expired", titleKey: "kiosk.state.payment_expired.title", subtitleKey: "kiosk.state.payment_expired.subtitle" },
  chargenow_failed: { phase: "support", titleKey: "kiosk.state.chargenow_failed.title", subtitleKey: "kiosk.state.chargenow_failed.subtitle" },
  eject_failed: { phase: "support", titleKey: "kiosk.state.eject_failed.title", subtitleKey: "kiosk.state.eject_failed.subtitle" },
  needs_support: { phase: "support", titleKey: "kiosk.state.needs_support.title", subtitleKey: "kiosk.state.needs_support.subtitle" },
  manual_review: { phase: "support", titleKey: "kiosk.state.manual_review.title", subtitleKey: "kiosk.state.manual_review.subtitle" },
  refunded: { phase: "error", titleKey: "kiosk.state.refunded.title", subtitleKey: "kiosk.state.refunded.subtitle" },
  payment_cancelled: { phase: "error", titleKey: "kiosk.state.payment_cancelled.title", subtitleKey: "kiosk.state.payment_cancelled.subtitle" },
  cancelled: { phase: "error", titleKey: "kiosk.state.cancelled.title", subtitleKey: "kiosk.state.cancelled.subtitle" },
};

/** Uses only the scoped, server-confirmed rental projection; never a redirect. */
export function kioskPaymentPresentation(state: string, failureCode?: string | null): KioskPaymentPresentation | null {
  if (failureCode && FAILURE_PRESENTATION[failureCode]) return FAILURE_PRESENTATION[failureCode];
  return STATE_PRESENTATION[state] ?? null;
}
