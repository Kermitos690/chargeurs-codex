import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export const PLATFORM_API_VERSION = "1.0.0";

export const apiCorsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-api-key, x-idempotency-key, x-kiosk-token, content-type, x-request-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

export type ApiEnvironment = "test" | "live";

export type PlatformApiPrincipal = {
  keyId: string;
  clientId: string;
  clientName: string;
  environment: ApiEnvironment;
  scopes: string[];
  rateLimitPerMinute: number;
  keyPrefix: string;
};

export type PlatformApiAuthResult =
  | { ok: true; principal: PlatformApiPrincipal; rate: { limit: number; remaining: number; resetAt: string } }
  | { ok: false; status: number; code: string; message: string; rate?: { limit: number; remaining: number; resetAt: string } };

export function apiJson(
  body: unknown,
  status = 200,
  requestId?: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...apiCorsHeaders,
      ...(requestId ? { "X-Request-Id": requestId } : {}),
      ...extraHeaders,
    },
  });
}

export function getRequestId(req: Request): string {
  const candidate = (req.headers.get("x-request-id") ?? "").trim();
  return /^[0-9a-f-]{36}$/i.test(candidate) ? candidate : crypto.randomUUID();
}

export function extractApiPath(req: Request): string {
  const pathname = new URL(req.url).pathname.replace(/\/+$/, "") || "/";
  const marker = "/platform-api";
  const markerIndex = pathname.indexOf(marker);
  const relative = markerIndex >= 0 ? pathname.slice(markerIndex + marker.length) : pathname;
  return relative || "/";
}

export function readApiKey(req: Request): string | null {
  const direct = (req.headers.get("x-api-key") ?? "").trim();
  if (direct) return direct;
  const auth = (req.headers.get("authorization") ?? "").trim();
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function hasApiScope(principal: PlatformApiPrincipal, required: string): boolean {
  if (principal.scopes.includes("*") || principal.scopes.includes(required)) return true;
  const [namespace] = required.split(":");
  return principal.scopes.includes(`${namespace}:*`);
}

function normalizeRate(value: unknown, fallback: number): { limit: number; remaining: number; resetAt: string } {
  const obj = (value ?? {}) as Record<string, unknown>;
  const limit = Number(obj.limit ?? fallback);
  const remaining = Number(obj.remaining ?? 0);
  const resetAt = String(obj.reset_at ?? new Date(Date.now() + 60_000).toISOString());
  return {
    limit: Number.isFinite(limit) ? limit : fallback,
    remaining: Number.isFinite(remaining) ? remaining : 0,
    resetAt,
  };
}

export async function authenticatePlatformRequest(
  req: Request,
  db: SupabaseClient,
): Promise<PlatformApiAuthResult> {
  const rawKey = readApiKey(req);
  if (!rawKey || !/^chg_(test|live)_[A-Za-z0-9_-]{24,}$/.test(rawKey)) {
    return { ok: false, status: 401, code: "API_KEY_REQUIRED", message: "Valid Chargeurs.ch API key required." };
  }

  const hash = await sha256Hex(rawKey);
  const { data, error } = await db
    .from("api_keys")
    .select("id,client_id,key_prefix,scopes,rate_limit_per_minute,active,expires_at,revoked_at,api_clients!inner(id,name,environment,active)")
    .eq("key_hash", hash)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, status: 401, code: "API_KEY_INVALID", message: "API key not recognized." };
  }

  const row = data as unknown as Record<string, unknown>;
  const clientRaw = row.api_clients as Record<string, unknown> | Record<string, unknown>[] | null;
  const client = Array.isArray(clientRaw) ? clientRaw[0] : clientRaw;
  const expired = row.expires_at != null && new Date(String(row.expires_at)).getTime() <= Date.now();
  const inactive = row.active !== true || row.revoked_at != null || client?.active !== true;
  if (expired || inactive) {
    return { ok: false, status: 403, code: "API_KEY_DISABLED", message: "API key is expired, revoked or inactive." };
  }

  const principal: PlatformApiPrincipal = {
    keyId: String(row.id),
    clientId: String(row.client_id),
    clientName: String(client?.name ?? "API client"),
    environment: String(client?.environment ?? "test") === "live" ? "live" : "test",
    scopes: Array.isArray(row.scopes) ? row.scopes.map(String) : [],
    rateLimitPerMinute: Math.max(1, Number(row.rate_limit_per_minute ?? 120)),
    keyPrefix: String(row.key_prefix ?? ""),
  };

  const { data: quota, error: quotaError } = await db.rpc("consume_platform_api_quota", {
    p_key_id: principal.keyId,
    p_limit: principal.rateLimitPerMinute,
    p_window_seconds: 60,
  });
  if (quotaError) {
    return { ok: false, status: 503, code: "RATE_LIMIT_UNAVAILABLE", message: "API quota service unavailable." };
  }

  const rate = normalizeRate(quota, principal.rateLimitPerMinute);
  const allowed = Boolean((quota as Record<string, unknown> | null)?.allowed);
  if (!allowed) {
    return { ok: false, status: 429, code: "RATE_LIMITED", message: "API rate limit exceeded.", rate };
  }

  db.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", principal.keyId).then(() => {}, () => {});
  return { ok: true, principal, rate };
}

export function rateHeaders(rate?: { limit: number; remaining: number; resetAt: string }): Record<string, string> {
  if (!rate) return {};
  return {
    "X-RateLimit-Limit": String(rate.limit),
    "X-RateLimit-Remaining": String(rate.remaining),
    "X-RateLimit-Reset": rate.resetAt,
  };
}

async function optionalIpHash(req: Request): Promise<string | null> {
  const salt = Deno.env.get("API_LOG_HASH_SALT") ?? "";
  if (!salt) return null;
  const ip = (req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? "")
    .split(",")[0]
    .trim();
  return ip ? await sha256Hex(`${salt}:${ip}`) : null;
}

export async function logPlatformRequest(
  db: SupabaseClient,
  args: {
    req: Request;
    requestId: string;
    principal?: PlatformApiPrincipal | null;
    path: string;
    statusCode: number;
    startedAt: number;
    errorCode?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    const userAgent = (args.req.headers.get("user-agent") ?? "").slice(0, 500) || null;
    await db.from("api_request_logs").insert({
      request_id: args.requestId,
      client_id: args.principal?.clientId ?? null,
      key_id: args.principal?.keyId ?? null,
      environment: args.principal?.environment ?? null,
      method: args.req.method,
      path: args.path.slice(0, 500),
      status_code: args.statusCode,
      duration_ms: Math.max(0, Date.now() - args.startedAt),
      error_code: args.errorCode ?? null,
      ip_hash: await optionalIpHash(args.req),
      user_agent: userAgent,
      metadata: args.metadata ?? {},
    });
  } catch (_) {
    // Observability must never change the API result.
  }
}
