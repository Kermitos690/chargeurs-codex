import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { readKioskToken } from "@/lib/kioskFetch";
import {
  KIOSK_CABINET_WAKE_EVENT,
  invokeKioskEdgeProxy,
} from "@/lib/kioskEdgeProxy";
import { KioskReturnOverlay } from "./KioskReturnOverlay";

const FALLBACK_CHECK_MS = 60_000;
const ACTIVE_WINDOW_MS = 5 * 60_000;

type ReturnProbe = {
  ok?: boolean;
  stage?: "none" | "settling" | "completed" | "support";
};

function stationFromPath(pathname: string) {
  const match = pathname.match(/^\/kiosk\/(?:station\/)?([A-Za-z0-9_-]{4,32})(?:\/|$)/);
  return match?.[1] ?? null;
}

/**
 * Keeps the expensive return overlay asleep while no return is happening.
 *
 * Normal path:
 *   cabinet broadcast -> kioskEdgeProxy invalidates its read cache -> this gate
 *   wakes the overlay immediately.
 *
 * Safety path:
 *   a sparse fallback probe catches a missed broadcast. The proxy's quiet cache
 *   and 402/429/5xx retry budget remain authoritative, so the fallback cannot
 *   recreate the historical sub-second network storm.
 */
export function KioskReturnOverlayGate() {
  const location = useLocation();
  const stationId = useMemo(() => stationFromPath(location.pathname), [location.pathname]);
  const [active, setActive] = useState(false);
  const activeTimerRef = useRef<number | null>(null);

  const activateTemporarily = useCallback(() => {
    setActive(true);
    if (activeTimerRef.current !== null) window.clearTimeout(activeTimerRef.current);
    activeTimerRef.current = window.setTimeout(() => {
      activeTimerRef.current = null;
      setActive(false);
    }, ACTIVE_WINDOW_MS);
  }, []);

  const probe = useCallback(async () => {
    const token = readKioskToken();
    if (!stationId || !token) return;
    const { data } = await invokeKioskEdgeProxy<ReturnProbe>(
      "/api/kiosk/return-summary",
      { stationId },
      { "X-Kiosk-Token": token },
    );
    if (data?.ok && data.stage && data.stage !== "none") activateTemporarily();
  }, [activateTemporarily, stationId]);

  useEffect(() => {
    if (!stationId || !readKioskToken()) {
      setActive(false);
      return;
    }

    const onCabinetWake = (event: Event) => {
      const detail = (event as CustomEvent<{ stationId?: string }>).detail;
      if (detail?.stationId !== stationId) return;
      activateTemporarily();
      void probe();
    };
    const onFlowComplete = () => {
      if (activeTimerRef.current !== null) window.clearTimeout(activeTimerRef.current);
      activeTimerRef.current = null;
      setActive(false);
    };

    void probe();
    const fallbackId = window.setInterval(() => void probe(), FALLBACK_CHECK_MS);
    window.addEventListener(KIOSK_CABINET_WAKE_EVENT, onCabinetWake as EventListener);
    window.addEventListener("chargeurs:kiosk-flow-complete", onFlowComplete);

    return () => {
      window.clearInterval(fallbackId);
      window.removeEventListener(KIOSK_CABINET_WAKE_EVENT, onCabinetWake as EventListener);
      window.removeEventListener("chargeurs:kiosk-flow-complete", onFlowComplete);
      if (activeTimerRef.current !== null) window.clearTimeout(activeTimerRef.current);
      activeTimerRef.current = null;
    };
  }, [activateTemporarily, probe, stationId]);

  return active ? <KioskReturnOverlay /> : null;
}
