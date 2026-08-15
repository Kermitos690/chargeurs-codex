import { useEffect, useRef, useState } from "react";

/**
 * Keeps the Premium wrapper's 35s journey timeout away from the payment rail.
 *
 * KioskPremiumGateV2 historically treats any `.kiosk-release-stage` as an
 * inner-owned protected journey. Payment READY / Terminal / QR did not use that
 * class, so the outer 35s timer could still return the kiosk home while Stripe
 * payment was in progress.
 *
 * This guard is intentionally presentation/lifecycle-only: it never changes a
 * rental, Stripe, terminal or hardware state. Once payment starts it remains
 * armed through server confirmation/support until the inner kiosk returns to
 * its idle battery chooser or unmounts. The hidden marker is tagged `inner` so
 * an explicit customer Cancel/Return-home action is still allowed by V2.
 */
export function KioskPaymentTimeoutGuard() {
  const [protectedJourney, setProtectedJourney] = useState(false);
  const armedRef = useRef(false);

  useEffect(() => {
    const inspect = () => {
      const kioskMounted = Boolean(document.querySelector(".kiosk-root"));
      if (!kioskMounted) {
        armedRef.current = false;
        setProtectedJourney(false);
        return;
      }

      const paymentStarted = Boolean(document.querySelector(
        ".kiosk-payment-rail-stage, .kiosk-qr-stage, .kiosk-release-stage:not([data-kiosk-timeout-owner=\"inner\"]), .kiosk-ready-stage",
      ));
      if (paymentStarted) armedRef.current = true;

      // The explicit inner reset is the only automatic disarm while Kiosk stays mounted.
      if (armedRef.current && document.querySelector(".kiosk-idle-stage")) {
        armedRef.current = false;
      }

      setProtectedJourney(armedRef.current);
    };

    inspect();
    const observer = new MutationObserver(inspect);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  if (!protectedJourney) return null;

  return (
    <span
      aria-hidden="true"
      className="kiosk-release-stage"
      data-kiosk-timeout-owner="inner"
      data-kiosk-payment-timeout-guard="active"
      hidden
    />
  );
}
