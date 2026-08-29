import { legacyReconciliationUuid } from "@/lib/kioskReconciliationId";
import { supabase } from "@/integrations/supabase/client";

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
export const KIOSK_CABINET_WAKE_EVENT = "chargeurs:kiosk-cabinet-wake";

const QUIET_READ_TTL_MS = 10 * 60_000;
const SETTLING_READ_TTL_MS = 2_000;
const FINAL_READ_TTL_MS = 5_000;
const AD_IMPRESSION_SAMPLE_MS = 30 * 60_000;
const AD_IMPRESSION_SAMPLE_PREFIX = "chargeurs:ads:impression-sample:";
const POST_EVENT_REINVALIDATE_MS = 1_500;
const PAYMENT_REQUIRED_RETRY_BASE_MS = 60_000;
const PAYMENT_REQUIRED_RETRY_MAX_MS = 10 * 60_000;
const RATE_LIMIT_RETRY_BASE_MS = 5_000;
const RATE_LIMIT_RETRY_MAX_MS = 2 * 60_000;
const SERVER_ERROR_RETRY_BASE_MS = 2_000;
const SERVER_ERROR_RETRY_MAX_MS = 30_000;

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

type CachedProxyResult = {
  expiresAt: number;
  result: KioskProxyResult<unknown>;
};

type ReadFailureBudget = {
  failures: number;
  retryAt: number;
  result: KioskProxyResult<unknown>;
};

const readCache = new Map<string, CachedProxyResult>();
const readInflight = new Map<string, Promise<KioskProxyResult<unknown>>>();
const readFailureBudget = new Map<string, ReadFailureBudget>();
const stationCacheKeys = new Map<string, Set<string>>();
const cabinetWakeSubscriptions = new Set<string>();

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

function stationIdFromBody(body: Record<string, unknown>): string {
  return typeof body.stationId === "string" ? body.stationId.trim() : "";
}

function cacheKey(path: KioskProxyPath, body: Record<string, unknown>): string {
  return `${path}:${JSON.stringify(body)}`;
}

function rememberStationCacheKey(stationId: string, key: string) {
  if (!stationId) return;
  const keys = stationCacheKeys.get(stationId) ?? new Set<string>();
  keys.add(key);
  stationCacheKeys.set(stationId, keys);
}

export function invalidateKioskReadCache(stationId?: string) {
  if (!stationId) {
    readCache.clear();
    stationCacheKeys.clear();
    return;
  }
  const keys = stationCacheKeys.get(stationId);
  if (!keys) return;
  keys.forEach((key) => readCache.delete(key));
  stationCacheKeys.delete(stationId);
}

function ensureCabinetWakeSubscription(stationId: string) {
  if (!stationId || cabinetWakeSubscriptions.has(stationId)) return;
  cabinetWakeSubscriptions.add(stationId);

  supabase
    .channel(`kiosk-cabinet:${stationId}`)
    .on("broadcast", { event: "cabinet_event" }, () => {
      // The broadcast contains no payment, customer or battery identity. It is
      // only a wake-up hint; the next authenticated read remains authoritative.
      // Invalidate twice so a read that was already in flight when the physical
      // event arrived cannot repopulate a stale 10-minute cache immediately
      // after the first invalidation.
      invalidateKioskReadCache(stationId);
      window.dispatchEvent(new CustomEvent(KIOSK_CABINET_WAKE_EVENT, {
        detail: { stationId },
      }));
      window.setTimeout(() => invalidateKioskReadCache(stationId), POST_EVENT_REINVALIDATE_MS);
    })
    .subscribe();
}

function readTtlMs(path: KioskProxyPath, body: Record<string, unknown>, data: unknown): number {
  if (path === "/api/kiosk/cabinet-snapshot") return QUIET_READ_TTL_MS;
  if (path === "/api/kiosk/ads-playlist" && body.action === "playlist") return QUIET_READ_TTL_MS;
  if (path !== "/api/kiosk/return-summary" || body.ackRentalSessionId) return 0;
  if (!data || typeof data !== "object") return 0;

  const stage = (data as Record<string, unknown>).stage;
  if (stage === "settling") return SETTLING_READ_TTL_MS;
  if (stage === "completed" || stage === "support") return FINAL_READ_TTL_MS;
  return QUIET_READ_TTL_MS;
}

export function kioskReadRetryDelayMs(status: number | null, failures: number): number {
  const attempt = Math.max(1, Math.floor(failures));
  const exponential = (base: number, max: number) => Math.min(max, base * (2 ** Math.min(attempt - 1, 10)));
  if (status === 402) return exponential(PAYMENT_REQUIRED_RETRY_BASE_MS, PAYMENT_REQUIRED_RETRY_MAX_MS);
  if (status === 429) return exponential(RATE_LIMIT_RETRY_BASE_MS, RATE_LIMIT_RETRY_MAX_MS);
  if (status === null || status >= 500) return exponential(SERVER_ERROR_RETRY_BASE_MS, SERVER_ERROR_RETRY_MAX_MS);
  return 0;
}

function cachedResultFor<T>(path: KioskProxyPath, key: string): KioskProxyResult<T> | null {
  const cached = readCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    readCache.delete(key);
    return null;
  }

  if (path === "/api/kiosk/ads-playlist" && cached.result.data && typeof cached.result.data === "object") {
    return {
      ...cached.result,
      data: {
        ...(cached.result.data as Record<string, unknown>),
        serverTimeMs: Date.now(),
      } as T,
    };
  }
  return cached.result as KioskProxyResult<T>;
}

function transientFailureFor<T>(key: string): KioskProxyResult<T> | null {
  const failure = readFailureBudget.get(key);
  if (!failure) return null;
  if (failure.retryAt <= Date.now()) return null;
  return failure.result as KioskProxyResult<T>;
}

function rememberTransientFailure(key: string, result: KioskProxyResult<unknown>) {
  const previous = readFailureBudget.get(key);
  const failures = (previous?.failures ?? 0) + 1;
  const delay = kioskReadRetryDelayMs(result.status, failures);
  if (delay <= 0) {
    readFailureBudget.delete(key);
    return;
  }
  readFailureBudget.set(key, {
    failures,
    retryAt: Date.now() + delay,
    result,
  });
}

function impressionSampleKey(body: Record<string, unknown>): string {
  const stationId = stationIdFromBody(body);
  const mode = typeof body.displayMode === "string" ? body.displayMode : "unknown";
  return `${AD_IMPRESSION_SAMPLE_PREFIX}${stationId}:${mode}`;
}

function shouldSkipAdImpression(body: Record<string, unknown>): boolean {
  if (body.action !== "impression") return false;
  try {
    const raw = localStorage.getItem(impressionSampleKey(body));
    const previous = raw ? Number(raw) : 0;
    return Number.isFinite(previous) && previous > 0 && Date.now() - previous < AD_IMPRESSION_SAMPLE_MS;
  } catch {
    return false;
  }
}

function markAdImpressionSample(body: Record<string, unknown>) {
  if (body.action !== "impression") return;
  try {
    localStorage.setItem(impressionSampleKey(body), String(Date.now()));
  } catch {
    // Analytics sampling is best-effort and never affects Advertising playback.
  }
}

async function invokeNetwork<T>(
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

export async function invokeKioskEdgeProxy<T>(
  path: KioskProxyPath,
  body: Record<string, unknown>,
  headers: Record<string, string>,
): Promise<KioskProxyResult<T>> {
  const stationId = stationIdFromBody(body);
  if (stationId && (path === "/api/kiosk/return-summary" || path === "/api/kiosk/cabinet-snapshot")) {
    ensureCabinetWakeSubscription(stationId);
  }

  if (path === "/api/kiosk/ads-playlist" && shouldSkipAdImpression(body)) {
    return {
      data: { ok: true, sampled: true } as T,
      transportError: false,
      status: 200,
      authError: false,
    };
  }

  const key = cacheKey(path, body);
  const cacheable = readTtlMs(path, body, { stage: "none" }) > 0;
  if (cacheable) {
    const cached = cachedResultFor<T>(path, key);
    if (cached) return cached;

    const pending = readInflight.get(key);
    if (pending) return pending as Promise<KioskProxyResult<T>>;

    const suppressed = transientFailureFor<T>(key);
    if (suppressed) return suppressed;
  }

  const request = invokeNetwork<T>(path, body, headers);
  if (cacheable) readInflight.set(key, request as Promise<KioskProxyResult<unknown>>);

  try {
    const result = await request;
    const successful = !result.transportError
      && !result.authError
      && result.status !== null
      && result.status >= 200
      && result.status < 300;
    const ttl = readTtlMs(path, body, result.data);

    if (cacheable) {
      if (successful) {
        readFailureBudget.delete(key);
      } else {
        rememberTransientFailure(key, result as KioskProxyResult<unknown>);
      }
    }

    if (ttl > 0 && successful) {
      readCache.set(key, { expiresAt: Date.now() + ttl, result: result as KioskProxyResult<unknown> });
      rememberStationCacheKey(stationId, key);
    }
    if (path === "/api/kiosk/ads-playlist" && body.action === "impression" && successful) {
      markAdImpressionSample(body);
    }
    return result;
  } finally {
    if (cacheable) readInflight.delete(key);
  }
}

export function __resetKioskEdgeProxyStateForTests() {
  readCache.clear();
  readInflight.clear();
  readFailureBudget.clear();
  stationCacheKeys.clear();
}
