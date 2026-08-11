// Short-lived kiosk <-> customer account pairing helpers.
// Raw pairing tokens are bearer capabilities and are never persisted.

export const CUSTOMER_PAIRING_TTL_SECONDS = 600;

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function createCustomerPairingToken(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function pairingTokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function validPairingToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{40,80}$/.test(value);
}
