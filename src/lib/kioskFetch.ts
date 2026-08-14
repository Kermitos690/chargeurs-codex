const KIOSK_TOKEN_KEY = "kiosk_token";
const KIOSK_SYNC_FUNCTION_PATH = "/functions/v1/sync-cabinet-status";
const KIOSK_QUOTE_RPC_PATH = "/rest/v1/rpc/kiosk_quote";

const PREMIUM_GUEST = {
  currency: "CHF",
  depositCents: 0,
  totalCapCents: 2_990,
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

export function isKioskCabinetSyncRequest(input: RequestInfo | URL): boolean {
  return requestPath(input).endsWith(KIOSK_SYNC_FUNCTION_PATH);
}

export function isKioskQuoteRequest(input: RequestInfo | URL): boolean {
  return requestPath(input).endsWith(KIOSK_QUOTE_RPC_PATH);
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
  const response = await globalThis.fetch(input, buildKioskAwareRequestInit(input, init));
  return guardKioskQuoteResponse(input, response);
};
