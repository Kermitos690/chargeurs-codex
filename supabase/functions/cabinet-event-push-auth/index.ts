// ChargeNow global cabinet-event gateway.
//
// ChargeNow E1 does not expose a configurable secret header for event push.
// This public gateway therefore accepts only a derived HMAC token in the URL,
// scoped to this single receiver. The raw ChargeNow callback/event secret never
// leaves the Edge Function environment. After verification, the request is
// forwarded internally to the canonical cabinet-event-push receiver using the
// existing x-event-secret header contract.

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
    "raw",
    encoder.encode(rawSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(TOKEN_SCOPE));
  return base64Url(new Uint8Array(signature));
}

function reply(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return reply({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const rawSecret = secret();
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  if (!rawSecret || !supabaseUrl) return reply({ ok: false, error: "CONFIGURATION_ERROR" }, 503);

  const url = new URL(req.url);
  const provided = url.searchParams.get("token") ?? req.headers.get("x-chargenow-push-token") ?? "";
  if (!safeEqual(provided, await expectedToken(rawSecret))) {
    return reply({ ok: false, error: "INVALID_PUSH_TOKEN" }, 401);
  }

  const body = await req.text();
  if (body.length > MAX_BODY_BYTES) return reply({ ok: false, error: "PAYLOAD_TOO_LARGE" }, 413);

  const upstream = await fetch(`${supabaseUrl.replace(/\/$/, "")}/functions/v1/cabinet-event-push`, {
    method: "POST",
    headers: {
      "Content-Type": req.headers.get("content-type") ?? "application/json",
      "x-event-secret": rawSecret,
    },
    body,
  });

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { "Content-Type": upstream.headers.get("content-type") ?? "application/json", "Cache-Control": "no-store" },
  });
});
