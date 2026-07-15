export const PLATFORM_WEBHOOK_MAX_ATTEMPTS = 8;

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256(key: string, message: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
  return new Uint8Array(signature);
}

export async function derivePlatformWebhookSecret(
  endpointId: string,
  secretNonce: string,
  masterSecret = Deno.env.get("PLATFORM_API_WEBHOOK_MASTER_SECRET") ?? "",
): Promise<string> {
  if (masterSecret.length < 32) throw new Error("WEBHOOK_MASTER_SECRET_NOT_CONFIGURED");
  const derived = await hmacSha256(masterSecret, `chargeurs-webhook:v1:${endpointId}:${secretNonce}`);
  return `whsec_${base64Url(derived)}`;
}

export async function signPlatformWebhook(
  signingSecret: string,
  timestamp: string,
  eventId: string,
  body: string,
): Promise<string> {
  const signed = await hmacSha256(signingSecret, `${timestamp}.${eventId}.${body}`);
  return `v1=${hex(signed)}`;
}

export function validatePlatformWebhookUrl(value: string): { ok: true; url: string } | { ok: false; code: string } {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, code: "INVALID_WEBHOOK_URL" };
  }
  if (url.protocol !== "https:") return { ok: false, code: "WEBHOOK_HTTPS_REQUIRED" };
  if (url.username || url.password) return { ok: false, code: "WEBHOOK_CREDENTIALS_FORBIDDEN" };
  if (url.port && url.port !== "443") return { ok: false, code: "WEBHOOK_PORT_FORBIDDEN" };
  if (url.hash) return { ok: false, code: "WEBHOOK_FRAGMENT_FORBIDDEN" };

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname.includes(".")) return { ok: false, code: "WEBHOOK_PUBLIC_HOST_REQUIRED" };
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname === "metadata.google.internal" ||
    hostname === "169.254.169.254" ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) ||
    hostname.includes(":")
  ) {
    return { ok: false, code: "WEBHOOK_PRIVATE_HOST_FORBIDDEN" };
  }

  url.hash = "";
  return { ok: true, url: url.toString() };
}

export function nextPlatformWebhookAttempt(attemptNumber: number, now = Date.now()): string | null {
  const delaysMinutes = [1, 5, 30, 120, 720, 1440, 2880];
  if (attemptNumber >= PLATFORM_WEBHOOK_MAX_ATTEMPTS) return null;
  const delay = delaysMinutes[Math.max(0, Math.min(delaysMinutes.length - 1, attemptNumber - 1))];
  return new Date(now + delay * 60_000).toISOString();
}

export async function platformWebhookResponseHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value.slice(0, 4096)));
  return hex(new Uint8Array(digest));
}

export function webhookEventTypes(value: unknown): string[] {
  const allowed = new Set([
    "*",
    "rental.created",
    "rental.checkout_created",
    "rental.payment_succeeded",
    "rental.ejected",
    "rental.active",
    "rental.returned",
    "rental.completed",
    "rental.cancelled",
    "rental.refunded",
    "rental.incident",
    "rental.state_changed",
  ]);
  if (!Array.isArray(value)) return ["*"];
  const cleaned = [...new Set(value.map(String).filter((eventType) => allowed.has(eventType)))];
  return cleaned.length ? cleaned : ["*"];
}
