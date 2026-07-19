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

export async function requireRoles(
  req: Request,
  db: SupabaseClient,
  allowedRoles: readonly string[],
): Promise<string | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  const jwt = authHeader.replace("Bearer ", "");
  const { data: { user }, error } = await db.auth.getUser(jwt);
  if (error || !user) return null;
  const { data: roles } = await db.from("user_roles").select("role").eq("user_id", user.id);
  const accepted = (roles ?? []).some((row: { role: string }) => allowedRoles.includes(row.role));
  return accepted ? user.id : null;
}

// Operational administration. Finance/user-management functions use their
// narrower helpers instead of inheriting these permissions.
export async function requireAdmin(req: Request, db: SupabaseClient): Promise<string | null> {
  return requireRoles(req, db, ["super_admin", "admin", "operations_admin"]);
}

// Verify the caller is an authenticated super_admin. Returns user id or null.
export async function requireSuperAdmin(req: Request, db: SupabaseClient): Promise<string | null> {
  return requireRoles(req, db, ["super_admin"]);
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

// ---------------------------------------------------------------------------
// Kiosk device authentication (fail-closed, server-side, station-bound).
// The kiosk sends its provisioned token in the `X-Kiosk-Token` header ONLY.
// The token is never accepted from the URL, never logged raw. We hash it
// (sha-256 hex, matching the DB digest) and look up kiosk_devices. The device
// must be active, not revoked, not expired, and bound to the requested station.
// ---------------------------------------------------------------------------
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type KioskDevice = {
  id: string;
  station_id: string;
  active: boolean;
  token_revoked: boolean;
  token_expires_at: string | null;
  label: string | null;
};

export type KioskAuthResult =
  | { ok: true; device: KioskDevice; tokenFingerprint: string }
  | { ok: false; status: number; error: string };

// Minimum entropy bar for a provisioned kiosk token.
const KIOSK_TOKEN_MIN_LEN = 24;

export async function verifyKioskDevice(
  req: Request,
  db: SupabaseClient,
  stationId: string,
): Promise<KioskAuthResult> {
  const token = (req.headers.get("X-Kiosk-Token") ?? "").trim();
  if (!token || token.length < KIOSK_TOKEN_MIN_LEN) {
    return { ok: false, status: 401, error: "KIOSK_AUTH_REQUIRED" };
  }
  const hash = await sha256Hex(token);
  // tokenFingerprint = a NON-secret, short, irreversible id safe for logs.
  const tokenFingerprint = hash.slice(0, 12);

  const { data: dev } = await db
    .from("kiosk_devices")
    .select("id, station_id, active, token_revoked, token_expires_at, label")
    .eq("token_hash", hash)
    .maybeSingle();

  if (!dev) return { ok: false, status: 401, error: "KIOSK_AUTH_INVALID" };

  const expired = dev.token_expires_at !== null && new Date(dev.token_expires_at).getTime() < Date.now();
  if (!dev.active || dev.token_revoked || expired) {
    return { ok: false, status: 403, error: "KIOSK_DEVICE_DISABLED" };
  }
  if (dev.station_id !== stationId) {
    return { ok: false, status: 403, error: "KIOSK_STATION_MISMATCH" };
  }

  // Best-effort heartbeat; never blocks auth.
  db.from("kiosk_devices").update({ last_seen_at: new Date().toISOString() }).eq("id", dev.id)
    .then(() => {}, () => {});

  return { ok: true, device: dev as KioskDevice, tokenFingerprint };
}
