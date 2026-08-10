// The operator enters the enrollment code directly on a tablet with no
// camera. Keep it deliberately narrow: exactly six ASCII digits, including a
// leading zero. It is still protected server-side by a short expiry, one-time
// redemption, a station binding and SHA-256-at-rest storage.
const PAIRING_CODE = /^\d{6}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomOpaque(prefix: "kt_", byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  const value = btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  return prefix + value;
}

export function newSixDigitPairingCode(): string {
  // Rejection sampling avoids modulo bias. There are 1,000,000 valid values;
  // `limit` is the largest multiple of that space representable by uint32.
  const space = 1_000_000;
  const limit = Math.floor(0x1_0000_0000 / space) * space;
  const bytes = new Uint8Array(4);
  let value = limit;
  while (value >= limit) {
    crypto.getRandomValues(bytes);
    value = new DataView(bytes.buffer).getUint32(0, false);
  }
  return String(value % space).padStart(6, "0");
}

export function validEnrollmentRequest(pairingCode: string, devicePublicId: string, appVersion: string): boolean {
  return PAIRING_CODE.test(pairingCode) && UUID_V4.test(devicePublicId) && appVersion.length > 0 && appVersion.length <= 64;
}

export function normalizeKioskBaseUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    if (parsed.pathname !== "" && parsed.pathname !== "/") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}
