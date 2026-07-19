import { adminClient } from "../_shared/db.ts";
import { originAllowed, saltedIpHash, validatePublicContact } from "../_shared/publicContact.ts";

function response(origin: string | null, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": origin ?? "null",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Vary": "Origin",
    },
  });
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  const configuredOrigins = Deno.env.get("ALLOWED_ORIGINS") ?? "";
  if (!originAllowed(origin, configuredOrigins)) return response(null, { ok: false, error: "ORIGIN_FORBIDDEN" }, 403);
  if (req.method === "OPTIONS") return response(origin, { ok: true });
  if (req.method !== "POST") return response(origin, { ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const salt = Deno.env.get("PUBLIC_CONTACT_IP_HASH_SALT") ?? "";
  if (salt.length < 32) return response(origin, { ok: false, error: "NOT_CONFIGURED" }, 503);
  const contentLength = Number(req.headers.get("Content-Length") ?? 0);
  if (contentLength > 16_384) return response(origin, { ok: false, error: "PAYLOAD_TOO_LARGE" }, 413);

  let payload: unknown;
  try { payload = await req.json(); } catch { return response(origin, { ok: false, error: "INVALID_BODY" }, 400); }
  if (!payload || typeof payload !== "object") return response(origin, { ok: false, error: "INVALID_BODY" }, 400);
  const validation = validatePublicContact(payload);
  if (!validation.ok) return response(origin, { ok: false, error: validation.code }, 400);

  const forwarded = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  const ipHash = await saltedIpHash(forwarded, salt);
  const db = adminClient();
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await db.from("public_contact_requests")
    .select("id", { head: true, count: "exact" })
    .eq("ip_hash", ipHash)
    .gte("created_at", since);
  if ((count ?? 0) >= 5) return response(origin, { ok: false, error: "RATE_LIMITED" }, 429);

  const { data, error } = await db.from("public_contact_requests")
    .insert({ ...validation.value, ip_hash: ipHash })
    .select("id")
    .single();
  if (error) return response(origin, { ok: false, error: "REQUEST_NOT_RECORDED" }, 500);
  return response(origin, { ok: true, requestId: data.id }, 201);
});
