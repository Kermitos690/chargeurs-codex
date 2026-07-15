const KIOSK_TOKEN_KEY = "kiosk_token";
const KIOSK_SYNC_FUNCTION_PATH = "/functions/v1/sync-cabinet-status";

type TokenReader = () => string | null;

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

export function isKioskCabinetSyncRequest(input: RequestInfo | URL): boolean {
  try {
    return new URL(requestUrl(input), window.location.origin).pathname.endsWith(KIOSK_SYNC_FUNCTION_PATH);
  } catch {
    return requestUrl(input).includes(KIOSK_SYNC_FUNCTION_PATH);
  }
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

export const kioskAwareFetch: typeof fetch = (input, init) =>
  globalThis.fetch(input, buildKioskAwareRequestInit(input, init));
