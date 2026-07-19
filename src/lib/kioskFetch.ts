const KIOSK_TOKEN_KEY = "kiosk_token";
const KIOSK_SYNC_FUNCTION_PATH = "/functions/v1/sync-cabinet-status";
const KIOSK_QUOTE_RPC_PATH = "/rest/v1/rpc/kiosk_quote";

const EXPECTED_KIOSK_QUOTE = {
  currency: "CHF",
  periodMinutes: 30,
  firstPeriodCents: 75,
  depositCents: 3_000,
  dailyCapCents: 1_800,
  nonReturnCents: 9_900,
} as const;

const KIOSK_TOKEN_PATTERN = /^kt_[A-Za-z0-9_-]{24,128}$/;
const KIOSK_PAIRING_CODE_PATTERN = /^kc_[A-Za-z0-9_-]{16,64}$/;

type TokenReader = () => string | null;

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
 * Pairing codes (kc_) are never accepted as runtime kiosk credentials. They
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

export function isKioskCabinetSyncRequest(input: RequestInfo | URL): boolean {
  return requestPath(input).endsWith(KIOSK_SYNC_FUNCTION_PATH);
}

export function isKioskQuoteRequest(input: RequestInfo | URL): boolean {
  return requestPath(input).endsWith(KIOSK_QUOTE_RPC_PATH);
}

export function isSafeKioskQuote(value: unknown): boolean {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || typeof raw !== "object") return false;
  const quote = raw as Record<string, unknown>;
  if (quote.error) return false;
  return String(quote.currency ?? "").toUpperCase() === EXPECTED_KIOSK_QUOTE.currency
    && Number(quote.period_minutes) === EXPECTED_KIOSK_QUOTE.periodMinutes
    && Number(quote.duration_cents) === EXPECTED_KIOSK_QUOTE.firstPeriodCents
    && Number(quote.price_per_period_cents) === EXPECTED_KIOSK_QUOTE.firstPeriodCents
    && Number(quote.final_cents) === EXPECTED_KIOSK_QUOTE.firstPeriodCents
    && Number(quote.deposit_cents) === EXPECTED_KIOSK_QUOTE.depositCents
    && Number(quote.daily_cap_cents) === EXPECTED_KIOSK_QUOTE.dailyCapCents
    && Number(quote.unreturned_fee_cents) === EXPECTED_KIOSK_QUOTE.nonReturnCents;
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
  const response = await globalThis.fetch(input, buildKioskAwareRequestInit(input, init));
  return guardKioskQuoteResponse(input, response);
};
