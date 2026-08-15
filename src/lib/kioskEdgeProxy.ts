import { legacyReconciliationUuid } from "@/lib/kioskReconciliationId";

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
export const KIOSK_AUTH_REQUIRED_EVENT = "chargeurs:kiosk-auth-required";

export type KioskProxyResult<T> = {
  data: T | null;
  transportError: boolean;
  status: number | null;
  authError: boolean;
};

type KioskProxyPath =
  | "/api/kiosk/create-rental-session"
  | "/api/kiosk/create-stripe-checkout"
  | "/api/kiosk/cancel-checkout"
  | "/api/kiosk/cabinet-snapshot"
  | "/api/kiosk/reconcile-pending-ejection"
  | "/api/kiosk/return-summary"
  | "/api/kiosk/resume-state"
  | "/api/kiosk/customer-options"
  | "/api/kiosk/customer-pairing-create"
  | "/api/kiosk/customer-pairing-status"
  | "/api/kiosk/ads-clock"
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

function notifyKioskAuthenticationRejected(path: KioskProxyPath, status: number) {
  if (status !== 401 && status !== 403) return;
  window.dispatchEvent(new CustomEvent(KIOSK_AUTH_REQUIRED_EVENT, {
    detail: { path, status },
  }));
}

function cachedAdvertisingPlaylistFallback(
  path: KioskProxyPath,
  body: Record<string, unknown>,
): Record<string, unknown> | null {
  if (path !== "/api/kiosk/ads-playlist" || body.action !== "playlist") return null;
  const stationId = typeof body.stationId === "string" ? body.stationId.trim() : "";
  if (!stationId) return null;
  try {
    const raw = localStorage.getItem(`chargeurs:ads:playlist:${stationId}`);
    if (!raw) return null;
    const cached = JSON.parse(raw) as Record<string, unknown>;
    if (cached.ok !== true || !Array.isArray(cached.campaigns)) return null;
    // This is strictly the kiosk's already-cached public Ads projection. It does
    // not bypass server authorization or expose any new campaign/rental data.
    // A fresh local timestamp is supplied only so the Ads layer enters its
    // synchronized mode; the dedicated public Ads clock is authoritative.
    return {
      ...cached,
      ok: true,
      stationId,
      serverTimeMs: Date.now(),
      timelineEpochMs: Number(cached.timelineEpochMs ?? 0) || 0,
    };
  } catch {
    return null;
  }
}

function requestHeaders(headers: Record<string, string>) {
  return {
    "Content-Type": "application/json",
    apikey: PUBLIC_SUPABASE_KEY,
    Authorization: `Bearer ${PUBLIC_SUPABASE_KEY}`,
    ...headers,
  };
}

async function postKioskRequest(
  path: KioskProxyPath,
  body: Record<string, unknown>,
  headers: Record<string, string>,
) {
  return fetch(path, {
    method: "POST",
    cache: "no-store",
    headers: requestHeaders(headers),
    body: JSON.stringify(customerPairingPayload(path, body)),
  });
}

async function jsonOrNull<T>(response: Response): Promise<T | null> {
  try {
    return await response.json() as T;
  } catch {
    return null;
  }
}

function legacyReconciliationRetryBody(
  path: KioskProxyPath,
  body: Record<string, unknown>,
  status: number,
  data: unknown,
): Record<string, unknown> | null {
  if (path !== "/api/kiosk/reconcile-pending-ejection" || status !== 400 || !data || typeof data !== "object") return null;
  if ((data as Record<string, unknown>).error !== "INVALID_RECONCILIATION_REQUEST") return null;
  const rentalSessionId = typeof body.rentalSessionId === "string" ? body.rentalSessionId : "";
  const legacyId = legacyReconciliationUuid(rentalSessionId);
  return legacyId ? { ...body, rentalSessionId: legacyId } : null;
}

export async function invokeKioskEdgeProxy<T>(
  path: KioskProxyPath,
  body: Record<string, unknown>,
  headers: Record<string, string>,
): Promise<KioskProxyResult<T>> {
  try {
    let response = await postKioskRequest(path, body, headers);
    let data = await jsonOrNull<T>(response);

    // Staging reconcile-pending-ejection v9 contains a malformed 37-character
    // UUID validator. Always send the canonical UUID first. Only when that exact
    // read-only endpoint explicitly rejects the request do we retry once with a
    // PostgreSQL-equivalent representation. The canonical server fix is in main;
    // this compatibility path can stay inert until the corrected Edge version is live.
    const retryBody = legacyReconciliationRetryBody(path, body, response.status, data);
    if (retryBody) {
      response = await postKioskRequest(path, retryBody, headers);
      data = await jsonOrNull<T>(response);
    }

    if (data !== null) notifyKioskFlowComplete(path, data);
    notifyKioskAuthenticationRejected(path, response.status);

    if ((response.status === 401 || response.status === 403) && path === "/api/kiosk/ads-playlist") {
      const cached = cachedAdvertisingPlaylistFallback(path, body);
      if (cached) {
        return {
          data: cached as T,
          transportError: false,
          status: response.status,
          authError: true,
        };
      }
    }

    return {
      data,
      transportError: !response.ok && data === null,
      status: response.status,
      authError: response.status === 401 || response.status === 403,
    };
  } catch {
    return { data: null, transportError: true, status: null, authError: false };
  }
}
