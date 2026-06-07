import { useEffect, useState } from "react";

export type NetState = "online" | "offline";

// Lightweight browser connectivity tracker. Backend / ChargeNow / Stripe
// reachability is derived in the Kiosk component from real API results, never
// faked here.
export function useOnlineStatus(): NetState {
  const [net, setNet] = useState<NetState>(
    typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "online",
  );

  useEffect(() => {
    const on = () => setNet("online");
    const off = () => setNet("offline");
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  return net;
}
