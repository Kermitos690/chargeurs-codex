const PAIRING_CODE = /^kc_[A-Za-z0-9_-]{16,64}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomOpaque(prefix: "kc_" | "kt_", byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  const value = btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  return prefix + value;
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

