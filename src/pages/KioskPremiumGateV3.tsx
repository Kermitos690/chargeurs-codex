import KioskPremiumGateV2 from "./KioskPremiumGateV2";

/**
 * Physical kiosk entry.
 *
 * The former V3 shell layered several independently scaled visual owners over
 * the same journey.  On the Android WebView that meant a 1280px canvas was
 * reduced from the top-left, leaving the actual payment stage off-centre.
 * The V2 journey is the single visual owner: it remains responsive to the
 * WebView viewport and owns the home, customer, payment and recovery screens.
 */
export default function KioskPremiumGateV3() {
  return <KioskPremiumGateV2 />;
}
