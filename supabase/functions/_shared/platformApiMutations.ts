import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  hasApiScope,
  sha256Hex,
  type PlatformApiPrincipal,
} from "./platformApi.ts";

export type MutationCapability = "database" | "stripe" | "hardware";

export type MutationGateResult =
  | { ok: true }
  | { ok: false; code: string; message: string };

export type IdempotencyClaim =
  | { kind: "new"; recordId: string; key: string }
  | { kind: "replay"; recordId: string; key: string; responseStatus: number; responseBody: unknown }
  | { kind: "conflict"; key: string }
  | { kind: "in_progress"; key: string };

export function readIdempotencyKey(req: Request): string | null {
  const value = (req.headers.get("x-idempotency-key") ?? "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(value)) return null;
  return value;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`).join(",")}}`;
}

export async function mutationRequestHash(method: string, path: string, body: unknown): Promise<string> {
  return await sha256Hex(`${method.toUpperCase()}\n${path}\n${canonicalize(body)}`);
}

function envTrue(name: string, env: (key: string) => string | undefined): boolean {
  return env(name) === "true";
}

export function stripeSecretMode(secret: string): "test" | "live" | "unknown" {
  if (secret.startsWith("sk_test_")) return "test";
  if (secret.startsWith("sk_live_")) return "live";
  return "unknown";
}

export function mutationGate(
  principal: PlatformApiPrincipal,
  capability: MutationCapability,
  env: (key: string) => string | undefined = (key) => Deno.env.get(key),
): MutationGateResult {
  if (!envTrue("PLATFORM_API_MUTATIONS_ENABLED", env)) {
    return {
      ok: false,
      code: "API_MUTATIONS_DISABLED",
      message: "Platform API mutations are disabled in this deployment.",
    };
  }

  if (principal.environment === "live" && !envTrue("PLATFORM_API_LIVE_MUTATIONS_ENABLED", env)) {
    return {
      ok: false,
      code: "LIVE_MUTATIONS_DISABLED",
      message: "Live Platform API mutations require explicit deployment approval.",
    };
  }

  if (capability === "hardware" && !envTrue("PLATFORM_API_HARDWARE_MUTATIONS_ENABLED", env)) {
    return {
      ok: false,
      code: "HARDWARE_MUTATIONS_DISABLED",
      message: "Hardware mutations are disabled in this deployment.",
    };
  }

  if (capability === "stripe") {
    const mode = stripeSecretMode(env("STRIPE_SECRET_KEY") ?? "");
    if (mode === "unknown") {
      return { ok: false, code: "STRIPE_NOT_CONFIGURED", message: "Stripe is not configured." };
    }
    if (mode !== principal.environment) {
      return {
        ok: false,
        code: "STRIPE_ENVIRONMENT_MISMATCH",
        message: `A ${principal.environment} API key cannot use the configured ${mode} Stripe environment.`,
      };
    }
  }

  return { ok: true };
}

export function canAccessRental(
  principal: PlatformApiPrincipal,
  session: Record<string, unknown>,
  mode: "read" | "write",
): boolean {
  const broadScope = mode === "read" ? "rentals:read:any" : "rentals:write:any";
  if (hasApiScope(principal, broadScope) || principal.scopes.includes("*")) return true;
  return String(session.api_client_id ?? "") === principal.clientId;
}

export async function claimPlatformApiIdempotency(
  db: SupabaseClient,
  input: {
    principal: PlatformApiPrincipal;
    key: string;
    method: string;
    path: string;
    requestHash: string;
    ttlHours?: number;
  },
): Promise<IdempotencyClaim> {
  const expiresAt = new Date(Date.now() + Math.max(1, input.ttlHours ?? 24) * 3_600_000).toISOString();
  const { data: inserted, error: insertError } = await db.from("api_idempotency_records").insert({
    key_id: input.principal.keyId,
    client_id: input.principal.clientId,
    idempotency_key: input.key,
    method: input.method.toUpperCase(),
    path: input.path,
    request_hash: input.requestHash,
    status: "processing",
    expires_at: expiresAt,
  }).select("id,idempotency_key").maybeSingle();

  if (!insertError && inserted) {
    return { kind: "new", recordId: String(inserted.id), key: input.key };
  }

  if ((insertError as { code?: string } | null)?.code !== "23505") {
    throw new Error(`IDEMPOTENCY_STORAGE_ERROR:${insertError?.message ?? "insert failed"}`);
  }

  const { data: existing, error } = await db.from("api_idempotency_records")
    .select("id,idempotency_key,request_hash,status,response_status,response_body,expires_at")
    .eq("key_id", input.principal.keyId)
    .eq("idempotency_key", input.key)
    .maybeSingle();
  if (error || !existing) throw new Error(`IDEMPOTENCY_STORAGE_ERROR:${error?.message ?? "record missing"}`);

  const expired = new Date(String(existing.expires_at)).getTime() <= Date.now();
  if (expired) {
    await db.from("api_idempotency_records").delete().eq("id", existing.id);
    return await claimPlatformApiIdempotency(db, input);
  }

  if (String(existing.request_hash) !== input.requestHash) {
    return { kind: "conflict", key: input.key };
  }

  if (existing.status === "completed" && existing.response_status != null) {
    return {
      kind: "replay",
      recordId: String(existing.id),
      key: input.key,
      responseStatus: Number(existing.response_status),
      responseBody: existing.response_body,
    };
  }

  return { kind: "in_progress", key: input.key };
}

export async function completePlatformApiIdempotency(
  db: SupabaseClient,
  input: {
    recordId: string;
    responseStatus: number;
    responseBody: unknown;
    resourceType?: string | null;
    resourceId?: string | null;
  },
): Promise<void> {
  const { error } = await db.from("api_idempotency_records").update({
    status: "completed",
    response_status: input.responseStatus,
    response_body: input.responseBody,
    resource_type: input.resourceType ?? null,
    resource_id: input.resourceId ?? null,
    completed_at: new Date().toISOString(),
  }).eq("id", input.recordId).eq("status", "processing");
  if (error) throw new Error(`IDEMPOTENCY_COMPLETE_ERROR:${error.message}`);
}
