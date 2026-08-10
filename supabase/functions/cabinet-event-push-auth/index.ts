// ChargeNow global cabinet-event gateway.
// ChargeNow E1 does not expose a configurable secret header. This gateway
// authenticates the provider URL with a receiver-scoped HMAC and forwards the
// request internally using the canonical x-event-secret contract.
//
// Cabinet clocks are not authoritative. Every authenticated JSON push is given
// a stable external event id (provider id when available, otherwise a SHA-256
// fingerprint of the original body). The canonical receiver's UNIQUE event-id
// constraint therefore owns replay protection without trusting provider time.

const encoder = new TextEncoder();
const MAX_BODY_BYTES = 64 * 1024;
const TOKEN_SCOPE = "chargeurs.ch:cabinet-event-push:v1";

function secret(): string {
  return Deno.env.get("CHARGENOW_CALLBACK_SECRET")
    ?? Deno.env.get("CHARGENOW_EVENT_SECRET")
    ?? "";
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

async function expectedToken(rawSecret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(rawSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(TOKEN_SCOPE));
  return base64Url(new Uint8Array(signature));
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function reply(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function normalizedProviderBody(rawBody: string, contentType: string): Promise<string> {
  if (!contentType.includes("application/json")) return rawBody;
  try {
    const payload = JSON.parse(rawBody) as Record<string, unknown>;
    const nested = payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
      ? { ...(payload.data as Record<string, unknown>) }
      : null;

    const existingEventId = ["messageId", "eventId", "msgId", "id"]
      .map((key) => payload[key] ?? nested?.[key])
      .find((value) => (typeof value === "string" && value.trim()) || (typeof value === "number" && Number.isFinite(value)));
    if (existingEventId == null) {
      payload.eventId = `gw_${(await sha256Hex(rawBody)).slice(0, 40)}`;
    }

    const timestampKeys = ["timestamp", "ts", "eventTime", "time"] as const;
    const providerTimestamp = timestampKeys
      .map((key) => payload[key] ?? nested?.[key])
      .find((value) => value !== undefined && value !== null);
    if (providerTimestamp != null && payload.providerTimestamp == null) payload.providerTimestamp = providerTimestamp;

    for (const key of timestampKeys) {
      delete payload[key];
      if (nested) delete nested[key];
    }
    if (nested) payload.data = nested;
    return JSON.stringify(payload);
  } catch {
    return rawBody;
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return reply({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const rawSecret = secret();
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  if (!rawSecret || !supabaseUrl) return reply({ ok: false, error: "CONFIGURATION_ERROR" }, 503);

  const url = new URL(req.url);
  const provided = url.searchParams.get("token") ?? req.headers.get("x-chargenow-push-token") ?? "";
  if (!safeEqual(provided, await expectedToken(rawSecret))) return reply({ ok: false, error: "INVALID_PUSH_TOKEN" }, 401);

  const body = await req.text();
  if (body.length > MAX_BODY_BYTES) return reply({ ok: false, error: "PAYLOAD_TOO_LARGE" }, 413);

  const contentType = req.headers.get("content-type") ?? "application/json";
  const upstream = await fetch(`${supabaseUrl.replace(/\/$/, "")}/functions/v1/cabinet-event-push`, {
    method: "POST",
    headers: { "Content-Type": contentType, "x-event-secret": rawSecret },
    body: await normalizedProviderBody(body, contentType),
  });

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { "Content-Type": upstream.headers.get("content-type") ?? "application/json", "Cache-Control": "no-store" },
  });
});
