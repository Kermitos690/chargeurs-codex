import type { NetState } from "@/hooks/useOnlineStatus";

/**
 * Android System WebView can report navigator.onLine=false while HTTPS calls
 * to Supabase still work through the modem/VPN. A successful server health
 * response is stronger evidence than that browser hint. We never fake
 * connectivity: a real Edge Function error still stops the rental safely.
 */
export function kioskTransportUnavailable(net: NetState, backendReachable: boolean | null): boolean {
  // The browser hint is never sufficient to block a rental on its own. Only a
  // failed real HTTPS request to our backend establishes transport failure.
  return net === "offline" && backendReachable === false;
}
