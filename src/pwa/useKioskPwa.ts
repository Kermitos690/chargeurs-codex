import { useEffect, useState } from "react";
import { subscribeNeedRefresh, applyKioskUpdate, getSwScriptUrl } from "@/pwa/registerSW";

// React surface over the kiosk service-worker registrar.
export function useKioskPwa() {
  const [needRefresh, setNeedRefresh] = useState(false);
  useEffect(() => subscribeNeedRefresh(setNeedRefresh), []);
  return {
    needRefresh,
    swUrl: getSwScriptUrl(),
    applyUpdate: applyKioskUpdate,
  };
}
