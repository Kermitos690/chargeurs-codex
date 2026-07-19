// Shared helpers for the read-only Chargeurs.ch Platform API v1.
// Raw API keys, raw IP addresses and upstream provider secrets are never logged.

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
  "Access-Control-Allow-Headers": "authorization, x-api-key, content-type, x-request-id, x-idempotency-key",
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
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function newRequestId(): string {
  return crypto.randomUUID();
}

export function jsonResponse(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
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

export function errorResponse(status: number, code: string, message: string, requestId: string): Response {
  return jsonResponse({ error: { code, message }, request_id: requestId }, status, { "x-request-id": requestId });
}

/** Extract a valid API key without ever logging it. X-API-Key takes precedence. */
export function extractKey(req: Request): string | null {
  const direct = (req.headers.get("x-api-key") ?? "").trim();
  const authorization = req.headers.get("authorization") ?? "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  const candidate = direct || bearer;
  return /^chg_(?:test|live)_[A-Za-z0-9_-]{24,}$/.test(candidate) ? candidate : null;
}

export async function authenticate(
  db: SupabaseClient,
  req: Request,
): Promise<{ ok: true; client: AuthedClient } | { ok: false; status: number; code: string; message: string }> {
  const raw = extractKey(req);
  if (!raw) return { ok: false, status: 401, code: "unauthorized", message: "API key required" };

  const hash = await sha256Hex(raw);
  const { data: key, error } = await db
    .from("api_keys")
    .select("id,client_id,revoked_at,api_clients:client_id(id,environment,scopes,active,revoked_at,quota_per_minute,quota_per_day)")
    .eq("key_hash", hash)
    .maybeSingle();

  if (error || !key || key.revoked_at) {
    return { ok: false, status: 401, code: "invalid_key", message: "Invalid or revoked API key" };
  }

  const client = Array.isArray(key.api_clients) ? key.api_clients[0] : key.api_clients;
  if (!client || !client.active || client.revoked_at) {
    return { ok: false, status: 401, code: "client_inactive", message: "Client is inactive" };
  }

  db.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", key.id).then(() => {}, () => {});

  return {
    ok: true,
    client: {
      clientId: String(client.id),
      keyId: String(key.id),
      environment: client.environment === "live" ? "live" : "test",
      scopes: (client.scopes ?? []).filter((scope: string): scope is PlatformApiScope =>
        (ALL_SCOPES as readonly string[]).includes(scope)
      ),
      quotaPerMinute: Math.max(1, Number(client.quota_per_minute ?? 60)),
      quotaPerDay: Math.max(1, Number(client.quota_per_day ?? 10_000)),
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
  return Number.isFinite(remaining) && remaining >= 0 ? { ok: true, remaining } : { ok: false };
}

async function hashClientIp(ip: string | null | undefined): Promise<string | null> {
  const normalized = (ip ?? "").split(",")[0].trim();
  const salt = (Deno.env.get("API_LOG_HASH_SALT") ?? "").trim();
  if (!normalized || !salt) return null;
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
  const safePath = entry.path.split("?")[0].slice(0, 512);
  try {
    await db.from("api_request_logs").insert({
      client_id: entry.client_id ?? null,
      key_id: entry.key_id ?? null,
      method: entry.method,
      path: safePath,
      status: entry.status,
      scope_required: entry.scope_required ?? null,
      ip_hash: await hashClientIp(entry.ip),
      user_agent: (entry.user_agent ?? "").slice(0, 256) || null,
      request_id: entry.request_id,
      latency_ms: Math.max(0, Math.trunc(entry.latency_ms)),
      error_code: entry.error_code ?? null,
    });
  } catch (_) {
    // Observability must never alter the API response.
  }
}

/** Generate a high-entropy API key. Persist only sha256Hex(raw). */
export function generateApiKey(environment: "test" | "live"): {
  raw: string;
  prefix: string;
  publicId: string;
} {
  const prefix = environment === "live" ? "chg_live_" : "chg_test_";
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return { raw: `${prefix}${suffix}`, prefix, publicId: suffix.slice(0, 12) };
}

export async function signPayload(secret: string, body: string, timestamp: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${body}`),
  );
  const hex = Array.from(new Uint8Array(signature)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `t=${timestamp},v1=${hex}`;
}
