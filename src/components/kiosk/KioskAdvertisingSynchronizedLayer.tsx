import { useEffect, useState } from "react";
import { KioskAdvertisingLayer } from "./KioskAdvertisingLayer";

const SYNC_HEARTBEAT_MS = 100;

/**
 * Keeps the isolated Ads runtime on a shared wall-clock cadence.
 *
 * KioskAdvertisingLayer derives the active carousel item from serverTimeMs and
 * timelineEpochMs. A small render heartbeat makes that derivation continuous,
 * so kiosks that boot, wake or refresh at different moments still converge on
 * the same media boundary. This wrapper owns no rental/payment/hardware state.
 */
export function KioskAdvertisingSynchronizedLayer() {
  const [, setHeartbeat] = useState(0);

  useEffect(() => {
    const pulse = () => setHeartbeat((value) => (value + 1) % 10_000);
    const timer = window.setInterval(pulse, SYNC_HEARTBEAT_MS);

    // Resume immediately after Android/WebView wake-up instead of waiting for a
    // complete media duration before correcting the visible carousel position.
    window.addEventListener("focus", pulse);
    window.addEventListener("pageshow", pulse);
    document.addEventListener("visibilitychange", pulse);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", pulse);
      window.removeEventListener("pageshow", pulse);
      document.removeEventListener("visibilitychange", pulse);
    };
  }, []);

  return <KioskAdvertisingLayer />;
}