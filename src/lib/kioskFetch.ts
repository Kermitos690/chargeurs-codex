const KIOSK_TOKEN_KEY = "kiosk_token";
const KIOSK_SYNC_FUNCTION_PATH = "/functions/v1/sync-cabinet-status";
const KIOSK_QUOTE_RPC_PATH = "/rest/v1/rpc/kiosk_quote";
const KIOSK_SESSION_STATUS_RPC_PATH = "/rest/v1/rpc/kiosk_session_status";
const STATIONS_REST_PATH = "/rest/v1/stations";
const QUOTA_RETRY_BASE_MS = 60_000;
const QUOTA_RETRY_MAX_MS = 10 * 60_000;
const RATE_LIMIT_RETRY_BASE_MS = 5_000;
const RATE_LIMIT_RETRY_MAX_MS = 2 * 60_000;
const SERVER_RETRY_BASE_MS = 2_000;
const SERVER_RETRY_MAX_MS = 30_000;

const PREMIUM_GUEST = {
  currency: "CHF",
  // The deposit is a separate authorization/guarantee. It is not part of the
  // rental total cap and must match the server-owned current pricing profile.
  depositCents: 3_000,
  totalCapCents: 3_000,
  tiers: [
    { upperMinutes: 30, totalCents: 190 },
    { upperMinutes: 120, totalCents: 390 },
    { upperMinutes: 360, totalCents: 590 },
    { upperMinutes: 1_440, totalCents: 790 },
  ],
} as const;

const KIOSK_TOKEN_PATTERN = /^kt_[A-Za-z0-9_-]{24,128}$/;
const KIOSK_PAIRING_CODE_PATTERN = /^\d{6}$/;

type TokenReader = () => string | null;
type RetrySnapshot = {
  failures: number;
  retryAt: number;
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
  body: string;
};

const kioskReadRetryBudget = new Map<string, RetrySnapshot>();

export function isValidKioskToken(value: unknown): value is string {
  return typeof value === "string" && KIOSK_TOKEN_PATTERN.test(value.trim());
}

export function isValidKioskPairingCode(value: unknown): value is string {
  return typeof value === "string" && KIOSK_PAIRING_CODE_PATTERN.test(value.trim());
}

/**
 * The native wrapper injects the credential into sessionStorage so it is not
 * persisted in the WebView profile. localStorage remains a deliberate browser
 * fallback for legacy/manual kiosk provisioning only.
 *
 * Six-digit pairing codes are never accepted as runtime kiosk credentials. They
 * must first be redeemed by kiosk-enroll for a real station-bound token (kt_).
 */
export function readKioskToken(): string | null {
  try {
    const candidate = sessionStorage.getItem(KIOSK_TOKEN_KEY) ?? localStorage.getItem(KIOSK_TOKEN_KEY);
    return isValidKioskToken(candidate) ? candidate.trim() : null;
  } catch {
    return null;
  }
}

export function storeKioskToken(token: string): boolean {
  const normalized = token.trim();
  if (!isValidKioskToken(normalized)) return false;
  try {
    localStorage.setItem(KIOSK_TOKEN_KEY, normalized);
    return true;
  } catch {
    return false;
  }
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function requestPath(input: RequestInfo | URL): string {
  try {
    return new URL(requestUrl(input), window.location.origin).pathname;
  } catch {
    return requestUrl(input);
  }
}

function requestMethod(input: RequestInfo | URL, init: RequestInit = {}): string {
  if (init.method) return init.method.toUpperCase();
  if (typeof Request !== "undefined" && input instanceof Request) return input.method.toUpperCase();
  return "GET";
}

export function isKioskCabinetSyncRequest(input: RequestInfo | URL): boolean {
  return requestPath(input).endsWith(KIOSK_SYNC_FUNCTION_PATH);
}

export function isKioskQuoteRequest(input: RequestInfo | URL): boolean {
  return requestPath(input).endsWith(KIOSK_QUOTE_RPC_PATH);
}

export function isQuotaProtectedKioskRead(input: RequestInfo | URL, init: RequestInit = {}): boolean {
  const path = requestPath(input);
  const method = requestMethod(input, init);
  if (path.endsWith(KIOSK_QUOTE_RPC_PATH) || path.endsWith(KIOSK_SESSION_STATUS_RPC_PATH)) {
    return method === "POST";
  }
  if (path.endsWith(STATIONS_REST_PATH)) return method === "GET" || method === "HEAD";
  return false;
}

function quotaProtectedReadKey(input: RequestInfo | URL, init: RequestInit = {}): string {
  return `${requestMethod(input, init)}:${requestPath(input)}`;
}

export function kioskReadTransportRetryDelayMs(status: number, failures: number): number {
  const attempt = Math.max(1, Math.floor(failures));
  const exponential = (base: number, max: number) => Math.min(max, base * (2 ** Math.min(attempt - 1, 10)));
  if (status === 402) return exponential(QUOTA_RETRY_BASE_MS, QUOTA_RETRY_MAX_MS);
  if (status === 429) return exponential(RATE_LIMIT_RETRY_BASE_MS, RATE_LIMIT_RETRY_MAX_MS);
  if (status >= 500) return exponential(SERVER_RETRY_BASE_MS, SERVER_RETRY_MAX_MS);
  return 0;
}

function syntheticRetryResponse(snapshot: RetrySnapshot): Response {
  return new Response(snapshot.body, {
    status: snapshot.status,
    statusText: snapshot.statusText,
    headers: snapshot.headers,
  });
}

async function rememberKioskReadFailure(key: string, response: Response) {
  const previous = kioskReadRetryBudget.get(key);
  const failures = (previous?.failures ?? 0) + 1;
  const delay = kioskReadTransportRetryDelayMs(response.status, failures);
  if (delay <= 0) {
    kioskReadRetryBudget.delete(key);
    return;
  }
  let body = "";
  try { body = await response.clone().text(); } catch { /* empty synthetic body */ }
  kioskReadRetryBudget.set(key, {
    failures,
    retryAt: Date.now() + delay,
    status: response.status,
    statusText: response.statusText,
    headers: Array.from(response.headers.entries()),
    body,
  });
}

function rememberKioskReadTransportFailure(key: string) {
  const previous = kioskReadRetryBudget.get(key);
  const failures = (previous?.failures ?? 0) + 1;
  const status = 503;
  const delay = kioskReadTransportRetryDelayMs(status, failures);
  kioskReadRetryBudget.set(key, {
    failures,
    retryAt: Date.now() + delay,
    status,
    statusText: "Kiosk read transport unavailable",
    headers: [["content-type", "application/json"]],
    body: JSON.stringify({ error: "KIOSK_READ_TRANSPORT_UNAVAILABLE" }),
  });
}

function isPremiumGuestQuote(quote: Record<string, unknown>): boolean {
  if (String(quote.customer_segment ?? "guest") !== "guest") return false;
  if (quote.tiered !== true) return false;
  if (String(quote.currency ?? "").toUpperCase() !== PREMIUM_GUEST.currency) return false;
  if (Number(quote.deposit_cents) !== PREMIUM_GUEST.depositCents) return false;
  if (Number(quote.total_cap_cents) !== PREMIUM_GUEST.totalCapCents) return false;
  if (Number(quote.final_cents) < PREMIUM_GUEST.tiers[0].totalCents || Number(quote.final_cents) > PREMIUM_GUEST.totalCapCents) return false;

  const tiers = Array.isArray(quote.tiers) ? quote.tiers : [];
  if (tiers.length !== PREMIUM_GUEST.tiers.length) return false;
  return PREMIUM_GUEST.tiers.every((expected, index) => {
    const actual = tiers[index];
    return Boolean(actual && typeof actual === "object")
      && Number((actual as Record<string, unknown>).upper_minutes) === expected.upperMinutes
      && Number((actual as Record<string, unknown>).total_cents) === expected.totalCents;
  });
}

function isConfiguredMemberQuote(quote: Record<string, unknown>): boolean {
  if (String(quote.customer_segment ?? "") !== "member") return false;
  if (String(quote.currency ?? "").toUpperCase() !== "CHF") return false;
  const finalCents = Number(quote.final_cents);
  const periodMinutes = Number(quote.period_minutes);
  const periodCents = Number(quote.price_per_period_cents);
  const maxCents = Number(quote.max_amount_cents);
  return Number.isFinite(finalCents) && finalCents > 0
    && Number.isFinite(periodMinutes) && periodMinutes > 0
    && Number.isFinite(periodCents) && periodCents > 0
    && Number.isFinite(maxCents) && maxCents >= finalCents;
}

export function isSafeKioskQuote(value: unknown): boolean {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || typeof raw !== "object") return false;
  const quote = raw as Record<string, unknown>;
  if (quote.error) return false;
  return isPremiumGuestQuote(quote) || isConfiguredMemberQuote(quote);
}

export function buildKioskAwareRequestInit(
  input: RequestInfo | URL,
  init: RequestInit = {},
  readToken: TokenReader = readKioskToken,
): RequestInit {
  if (!isKioskCabinetSyncRequest(input)) return init;

  const token = readToken()?.trim();
  if (!isValidKioskToken(token)) return init;

  const headers = new Headers(init.headers);
  if (!headers.has("X-Kiosk-Token")) headers.set("X-Kiosk-Token", token);
  return { ...init, headers };
}

async function guardKioskQuoteResponse(
  input: RequestInfo | URL,
  response: Response,
): Promise<Response> {
  if (!isKioskQuoteRequest(input) || !response.ok) return response;

  try {
    const payload = await response.clone().json();
    if (isSafeKioskQuote(payload)) return response;
  } catch {
    // A malformed quote is unsafe and is replaced by the same stable error.
  }

  const headers = new Headers(response.headers);
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify({ error: "PRICING_UNSAFE_CONFIGURATION" }), {
    status: 200,
    statusText: "OK",
    headers,
  });
}

export const kioskAwareFetch: typeof fetch = async (input, init) => {
  const requestInit = buildKioskAwareRequestInit(input, init);
  const quotaProtected = isQuotaProtectedKioskRead(input, requestInit);
  const key = quotaProtected ? quotaProtectedReadKey(input, requestInit) : "";
  if (quotaProtected) {
    const blocked = kioskReadRetryBudget.get(key);
    if (blocked && blocked.retryAt > Date.now()) return syntheticRetryResponse(blocked);
  }

  let response: Response;
  try {
    response = await globalThis.fetch(input, requestInit);
  } catch (error) {
    if (quotaProtected) rememberKioskReadTransportFailure(key);
    throw error;
  }
  const guarded = await guardKioskQuoteResponse(input, response);
  if (quotaProtected) {
    const delay = kioskReadTransportRetryDelayMs(guarded.status, (kioskReadRetryBudget.get(key)?.failures ?? 0) + 1);
    if (delay > 0) await rememberKioskReadFailure(key, guarded);
    else kioskReadRetryBudget.delete(key);
  }
  return guarded;
};

export function __resetKioskAwareFetchStateForTests() {
  kioskReadRetryBudget.clear();
}
