/**
 * Invoke kiosk-sensitive Edge Functions through the staging application's own
 * HTTPS origin. Some industrial Android WebViews load the Vercel kiosk page
 * correctly but abort a cross-origin `fetch` to Supabase after preflight.
 *
 * Vercel only relays the request; Supabase remains the authentication and
 * authorization boundary. The station-bound kiosk token stays in a request
 * header, is never placed in a URL, and is still hashed/verified by the Edge
 * Function.
 */
const STAGING_PUBLIC_SUPABASE_KEY = "sb_publishable_39LXZ2QrezT20u9dqDQX2Q_-yq4GX0d";
const PUBLIC_SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || STAGING_PUBLIC_SUPABASE_KEY;

export const KIOSK_PAIRING_STORAGE_KEY = "chargeurs:kiosk:customer-pairing-id";
export const KIOSK_JOURNEY_STORAGE_KEY = "chargeurs:kiosk:customer-journey";

export type KioskProxyResult<T> = {
  data: T | null;
  transportError: boolean;
};

type KioskProxyPath =
  | "/api/kiosk/create-rental-session"
  | "/api/kiosk/create-stripe-checkout"
  | "/api/kiosk/cabinet-snapshot"
  | "/api/kiosk/reconcile-pending-ejection"
  | "/api/kiosk/return-summary"
  | "/api/kiosk/resume-state"
  | "/api/kiosk/customer-options"
  | "/api/kiosk/customer-pairing-create"
  | "/api/kiosk/customer-pairing-status"
  | "/api/kiosk/ads-playlist";

function customerPairingPayload(path: KioskProxyPath, body: Record<string, unknown>): Record<string, unknown> {
  if (path !== "/api/kiosk/create-rental-session") return body;
  try {
    const pairingId = window.sessionStorage.getItem(KIOSK_PAIRING_STORAGE_KEY)?.trim() ?? "";
    if (/^[0-9a-f-]{36}$/i.test(pairingId)) {
      return { ...body, customerPairingId: pairingId };
    }
  } catch {
    // Storage is convenience state only. Missing storage can never grant a
    // member price; the server defaults to guest and validates every pairing.
  }
  return body;
}

function notifyKioskFlowComplete(path: KioskProxyPath, data: unknown) {
  if (path !== "/api/kiosk/reconcile-pending-ejection" || !data || typeof data !== "object") return;
  const result = data as Record<string, unknown>;
  if (result.confirmed === true && result.state === "ejected") {
    window.dispatchEvent(new CustomEvent("chargeurs:kiosk-flow-complete"));
  }
}

export async function invokeKioskEdgeProxy<T>(
  path: KioskProxyPath,
  body: Record<string, unknown>,
  headers: Record<string, string>,
): Promise<KioskProxyResult<T>> {
  try {
    const response = await fetch(path, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        apikey: PUBLIC_SUPABASE_KEY,
        Authorization: `Bearer ${PUBLIC_SUPABASE_KEY}`,
        ...headers,
      },
      body: JSON.stringify(customerPairingPayload(path, body)),
    });

    let data: T | null = null;
    try {
      data = await response.json() as T;
      notifyKioskFlowComplete(path, data);
    } catch {
      // A non-JSON gateway error is treated as a safe request failure below.
    }
    return { data, transportError: !response.ok && data === null };
  } catch {
    return { data: null, transportError: true };
  }
}
