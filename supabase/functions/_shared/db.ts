// Shared Supabase admin client + helpers for edge functions
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

// Audit logger — records every sensitive API call (redacted).
export async function logApi(
  db: SupabaseClient,
  entry: {
    service: string;
    endpoint: string;
    method: string;
    status_code?: number;
    request?: unknown;
    response?: unknown;
    error?: string | null;
  },
) {
  try {
    await db.from("api_logs").insert({
      service: entry.service,
      endpoint: entry.endpoint,
      method: entry.method,
      status_code: entry.status_code ?? null,
      request: redact(entry.request),
      response: redact(entry.response),
      error: entry.error ?? null,
    });
  } catch (_) { /* never block on logging */ }
}

function redact(obj: unknown): unknown {
  if (!obj || typeof obj !== "object") return obj ?? null;
  const clone = JSON.parse(JSON.stringify(obj));
  const secretKeys = ["password", "secret", "authorization", "apikey", "api_key", "token"];
  const walk = (o: Record<string, unknown>) => {
    for (const k of Object.keys(o)) {
      if (secretKeys.some((s) => k.toLowerCase().includes(s))) o[k] = "***";
      else if (o[k] && typeof o[k] === "object") walk(o[k] as Record<string, unknown>);
    }
  };
  if (typeof clone === "object") walk(clone);
  return clone;
}

// Verify the caller is an authenticated admin. Returns user id or null.
export async function requireAdmin(req: Request, db: SupabaseClient): Promise<string | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  const jwt = authHeader.replace("Bearer ", "");
  const { data: { user }, error } = await db.auth.getUser(jwt);
  if (error || !user) return null;
  const { data: roles } = await db.from("user_roles").select("role").eq("user_id", user.id);
  const isAdmin = (roles ?? []).some((r: { role: string }) => r.role === "admin");
  return isAdmin ? user.id : null;
}

export async function isSimulationMode(db: SupabaseClient): Promise<boolean> {
  const { data } = await db.from("kiosk_settings").select("value").eq("key", "simulation_mode").maybeSingle();
  return Boolean((data?.value as { enabled?: boolean })?.enabled);
}

// Resolve the caller's user id and roles from the JWT (null userId if anon).
export async function getCaller(req: Request, db: SupabaseClient): Promise<{ userId: string | null; roles: string[] }> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return { userId: null, roles: [] };
  const jwt = authHeader.replace("Bearer ", "");
  const { data: { user }, error } = await db.auth.getUser(jwt);
  if (error || !user) return { userId: null, roles: [] };
  const { data: roles } = await db.from("user_roles").select("role").eq("user_id", user.id);
  return { userId: user.id, roles: (roles ?? []).map((r: { role: string }) => r.role) };
}

// Append an immutable audit log entry. Never store secrets/tokens.
export async function auditLog(
  db: SupabaseClient,
  entry: { actor?: string | null; action: string; target?: string | null; data?: Record<string, unknown> },
) {
  try {
    await db.from("audit_logs").insert({
      actor: entry.actor ?? null,
      action: entry.action,
      target: entry.target ?? null,
      data: entry.data ?? null,
    });
  } catch (_) { /* never block on audit */ }
}

// Deterministic sha-256 hash of a canonical (sorted-key) JSON object.
export async function snapshotHash(obj: unknown): Promise<string> {
  const canonical = canonicalize(obj);
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function canonicalize(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalize).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonicalize(o[k])}`).join(",")}}`;
}
