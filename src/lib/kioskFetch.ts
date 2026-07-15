const KIOSK_TOKEN_KEY = "kiosk_token";
const KIOSK_SYNC_FUNCTION_PATH = "/functions/v1/sync-cabinet-status";
const KIOSK_QUOTE_RPC_PATH = "/rest/v1/rpc/kiosk_quote";

const EXPECTED_KIOSK_QUOTE = {
  currency: "CHF",
  periodMinutes: 30,
  firstPeriodCents: 75,
  depositCents: 3_000,
} as const;

type TokenReader = () => string | null;

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
    && Number(quote.final_cents) === EXPECTED_KIOSK_QUOTE.firstPeriodCents
    && Number(quote.deposit_cents) === EXPECTED_KIOSK_QUOTE.depositCents;
}

export function buildKioskAwareRequestInit(
  input: RequestInfo | URL,
  init: RequestInit = {},
  readToken: TokenReader = () => {
    try {
      return localStorage.getItem(KIOSK_TOKEN_KEY);
    } catch {
      return null;
    }
  },
): RequestInit {
  if (!isKioskCabinetSyncRequest(input)) return init;

  const token = readToken()?.trim();
  if (!token) return init;

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
