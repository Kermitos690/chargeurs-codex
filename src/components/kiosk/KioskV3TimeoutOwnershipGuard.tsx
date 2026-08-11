import { useEffect, useState } from "react";

/**
 * Compatibility guard between the V2 journey wrapper and the proven Kiosk
 * rental engine. Once the inner Kiosk is mounted, its own state-aware timeout
 * rules are authoritative (selection/pricing can expire; Stripe QR/payment and
 * release states are protected). The legacy outer wrapper must therefore not
 * start a second 35 s home timer over the same flow.
 *
 * The hidden marker is intentionally read only by the V2 guard. It performs no
 * navigation, payment, hardware or synthetic-input action.
 */
export function KioskV3TimeoutOwnershipGuard() {
  const [innerKioskMounted, setInnerKioskMounted] = useState(false);

  useEffect(() => {
    const detect = () => setInnerKioskMounted(Boolean(document.querySelector(".kiosk-root")));
    detect();
    const observer = new MutationObserver(detect);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  if (!innerKioskMounted) return null;
  return <span hidden data-kiosk-timeout-owner="inner" className="kiosk-release-stage" />;
}
