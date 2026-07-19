// Shared helpers for the read-only Platform API v1.
// - API key auth against public.api_keys (sha-256 hash)
// - Scope enforcement (health:read, stations:read, inventory:read,
//   pricing:read, rentals:read)
// - Atomic quota check via public.api_quota_hit
// - Redacted request logging (never persists secrets, raw IPs or upstream payloads)
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export const PLATFORM_API_VERSION = "v1";

export const ALL_SCOPES = [
  "health:read",
  "stations:read",
  "inventory:read",
  "pricing:read",
  "rentals:read",
] as const;
export type PlatformApiScope = typeof ALL_SCOPES[number];

export const platformCorsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-api-key, content-type, x-request-id, x-idempotency-key",
  "Access-Control-Max-Age": "86400",
};

export interface AuthedClient {
  clientId: string;
  keyId: string;
  environment: "test" | "live";
  scopes: PlatformApiScope[];
  quotaPerMinute: number;
  quotaPerDay: number;
}

export async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function newRequestId(): string {
  return (crypto as unknown as { randomUUID(): string }).randomUUID();
}

export function jsonResponse(
  body: unknown,
  status = 200,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...platformCorsHeaders,
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extra,
    },
  });
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  requestId: string,
): Response {
  return jsonResponse({ error: { code, message }, request_id: requestId }, status, {
    "x-request-id": requestId,
  });
}

/** Extract a raw API key without ever logging it. */
export function extractKey(req: Request): string | null {
  const direct = (req.headers.get("x-api-key") ?? "").trim();
  const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  const bearer = authHeader.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  const candidate = direct || bearer;
  return /^chg_(?:test|live)_[A-Za-z0-9_-]{24,}$/.test(candidate) ? candidate : null;
}

export async function authenticate(
  db: SupabaseClient,
  req: Request,
): Promise<{ ok: true; client: AuthedClient } | { ok: false; status: number; code: string; message: string }> {
  const raw = extractKey(req);
  if (!raw) {
    return { ok: false, status: 401, code: "unauthorized", message: "API key required" };
  }
  const hash = await sha256Hex(raw);
  const { data: key, error } = await db
    .from("api_keys")
    .select("id, client_id, revoked_at, api_clients:client_id(id, environment, scopes, active, revoked_at, quota_per_minute, quota_per_day)")
    .eq("key_hash", hash)
    .maybeSingle();
  if (error || !key || key.revoked_at) {
    return { ok: false, status: 401, code: "invalid_key", message: "Invalid or revoked API key" };
  }
  const cli = Array.isArray(key.api_clients) ? key.api_clients[0] : key.api_clients;
  if (!cli || !cli.active || cli.revoked_at) {
    return { ok: false, status: 401, code: "client_inactive", message: "Client is inactive" };
  }
  db.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", key.id).then(() => {});
  return {
    ok: true,
    client: {
      clientId: cli.id,
      keyId: key.id,
      environment: cli.environment,
      scopes: (cli.scopes ?? []).filter((s: string): s is PlatformApiScope =>
        (ALL_SCOPES as readonly string[]).includes(s)
      ),
      quotaPerMinute: cli.quota_per_minute ?? 60,
      quotaPerDay: cli.quota_per_day ?? 10000,
    },
  };
}

export function ensureScope(client: AuthedClient, required: PlatformApiScope): boolean {
  return client.scopes.includes(required);
}

export async function enforceQuota(
  db: SupabaseClient,
  client: AuthedClient,
): Promise<{ ok: true; remaining: number } | { ok: false }> {
  const { data, error } = await db.rpc("api_quota_hit", {
    p_key_id: client.keyId,
    p_per_minute: client.quotaPerMinute,
    p_per_day: client.quotaPerDay,
  });
  if (error) return { ok: false };
  const remaining = typeof data === "number" ? data : Number(data);
  if (remaining < 0) return { ok: false };
  return { ok: true, remaining };
}

async function hashClientIp(ip: string | null | undefined): Promise<string | null> {
  const normalized = (ip ?? "").split(",")[0].trim();
  if (!normalized) return null;
  const salt = Deno.env.get("API_LOG_HASH_SALT") ?? "chargeurs-api-log-v1";
  return await sha256Hex(`${salt}:${normalized}`);
}

export async function logRequest(
  db: SupabaseClient,
  entry: {
    client_id?: string | null;
    key_id?: string | null;
    method: string;
    path: string;
    status: number;
    scope_required?: string | null;
    ip?: string | null;
    user_agent?: string | null;
    request_id: string;
    latency_ms: number;
    error_code?: string | null;
  },
): Promise<void> {
  // Drop query strings: clients must never be able to leak credentials into logs.
  const safePath = entry.path.split("?")[0];
  try {
    await db.from("api_request_logs").insert({
      client_id: entry.client_id ?? null,
      key_id: entry.key_id ?? null,
      method: entry.method,
      path: safePath.slice(0, 512),
      status: entry.status,
      scope_required: entry.scope_required ?? null,
      // Existing schema column retained, but the value is now a one-way hash.
      ip: await hashClientIp(entry.ip),
      user_agent: (entry.user_agent ?? "").slice(0, 256) || null,
      request_id: entry.request_id,
      latency_ms: entry.latency_ms,
      error_code: entry.error_code ?? null,
    });
  } catch (_) {
    // Never block an API response on observability.
  }
}

/** Generate a raw API key. Only its hash must be persisted; raw is shown once. */
export function generateApiKey(env: "test" | "live"): {
  raw: string;
  prefix: string;
  publicId: string;
} {
  const prefix = env === "live" ? "chg_live_" : "chg_test_";
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  const raw = `${prefix}${suffix}`;
  return { raw, prefix, publicId: suffix.slice(0, 12) };
}

/** HMAC-SHA256 signature for outbound webhooks. */
export async function signPayload(secret: string, body: string, timestamp: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${body}`),
  );
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `t=${timestamp},v1=${hex}`;
}
