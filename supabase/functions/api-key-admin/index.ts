// Super-admin-only management for Chargeurs.ch Platform API clients and keys.
// Raw API keys are returned once when created and are never stored or logged.

import { adminClient, auditLog, requireSuperAdmin } from "../_shared/db.ts";
import { apiCorsHeaders, apiJson, sha256Hex } from "../_shared/platformApi.ts";

// Phase 1 is read-only. Write scopes are added only when their canonical handlers
// have been consolidated and validated on staging.
const ALLOWED_SCOPES = new Set([
  "health:read",
  "stations:read",
  "inventory:read",
  "pricing:read",
  "rentals:read",
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LIVE_KEYS_ENABLED = (Deno.env.get("PLATFORM_API_LIVE_KEYS_ENABLED") ?? "false").toLowerCase() === "true";

function randomToken(bytes = 32): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  const binary = Array.from(buffer, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function cleanScopes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(String).filter((scope) => ALLOWED_SCOPES.has(scope)))];
}

function validUuid(value: unknown): string | null {
  const candidate = String(value ?? "").trim();
  return UUID_RE.test(candidate) ? candidate : null;
}

function parseFutureDate(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value == null || value === "") return { ok: true, value: null };
  const timestamp = new Date(String(value));
  if (!Number.isFinite(timestamp.getTime()) || timestamp.getTime() <= Date.now()) return { ok: false };
  return { ok: true, value: timestamp.toISOString() };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: apiCorsHeaders });
  if (req.method !== "POST") return apiJson({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const db = adminClient();
  const actor = await requireSuperAdmin(req, db);
  if (!actor) return apiJson({ ok: false, error: "FORBIDDEN" }, 403);

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");

    if (action === "list") {
      const { data, error } = await db.from("api_clients")
        .select("id,name,environment,active,contact_email,description,metadata,created_at,updated_at,api_keys(id,name,key_prefix,scopes,rate_limit_per_minute,active,expires_at,last_used_at,revoked_at,created_at)")
        .order("created_at", { ascending: false });
      if (error) return apiJson({ ok: false, error: "DATABASE_ERROR" }, 500);
      return apiJson({ ok: true, clients: data ?? [] });
    }

    if (action === "create_client") {
      const name = String(body.name ?? "").trim();
      const environment = body.environment === "live" ? "live" : "test";
      if (name.length < 2 || name.length > 120) return apiJson({ ok: false, error: "INVALID_NAME" }, 400);
      if (environment === "live" && !LIVE_KEYS_ENABLED) {
        return apiJson({ ok: false, error: "LIVE_API_KEYS_DISABLED" }, 403);
      }

      const { data, error } = await db.from("api_clients").insert({
        name,
        environment,
        active: true,
        contact_email: body.contactEmail ? String(body.contactEmail).trim().slice(0, 320) : null,
        description: body.description ? String(body.description).trim().slice(0, 2000) : null,
        metadata: body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata) ? body.metadata : {},
        created_by: actor,
      }).select("id,name,environment,active,created_at").single();
      if (error) return apiJson({ ok: false, error: "CLIENT_CREATE_FAILED" }, 400);
      await auditLog(db, { actor, action: "platform_api.client.created", target: data.id, data: { name, environment } });
      return apiJson({ ok: true, client: data }, 201);
    }

    if (action === "set_client_active") {
      const clientId = validUuid(body.clientId);
      if (!clientId) return apiJson({ ok: false, error: "INVALID_CLIENT_ID" }, 400);
      const active = body.active === true;
      const { data, error } = await db.from("api_clients").update({ active }).eq("id", clientId)
        .select("id,name,environment,active,updated_at").maybeSingle();
      if (error) return apiJson({ ok: false, error: "CLIENT_UPDATE_FAILED" }, 400);
      if (!data) return apiJson({ ok: false, error: "CLIENT_NOT_FOUND" }, 404);
      await auditLog(db, { actor, action: active ? "platform_api.client.activated" : "platform_api.client.deactivated", target: clientId, data: {} });
      return apiJson({ ok: true, client: data });
    }

    if (action === "create_key") {
      const clientId = validUuid(body.clientId);
      if (!clientId) return apiJson({ ok: false, error: "INVALID_CLIENT_ID" }, 400);
      const { data: client } = await db.from("api_clients").select("id,name,environment,active").eq("id", clientId).maybeSingle();
      if (!client || !client.active) return apiJson({ ok: false, error: "CLIENT_NOT_FOUND_OR_INACTIVE" }, 404);
      if (client.environment === "live" && !LIVE_KEYS_ENABLED) {
        return apiJson({ ok: false, error: "LIVE_API_KEYS_DISABLED" }, 403);
      }

      const scopes = cleanScopes(body.scopes);
      if (scopes.length === 0) return apiJson({ ok: false, error: "AT_LEAST_ONE_VALID_SCOPE_REQUIRED" }, 400);
      const parsedRate = Number(body.rateLimitPerMinute ?? 120);
      if (!Number.isFinite(parsedRate)) return apiJson({ ok: false, error: "INVALID_RATE_LIMIT" }, 400);
      const rate = Math.max(1, Math.min(10000, Math.trunc(parsedRate)));
      const expiry = parseFutureDate(body.expiresAt);
      if (!expiry.ok) return apiJson({ ok: false, error: "INVALID_EXPIRATION" }, 400);

      const rawKey = `chg_${client.environment}_${randomToken(32)}`;
      const keyPrefix = rawKey.slice(0, 22);
      const keyHash = await sha256Hex(rawKey);
      const { data, error } = await db.from("api_keys").insert({
        client_id: clientId,
        name: String(body.name ?? "Default key").trim().slice(0, 120) || "Default key",
        key_prefix: keyPrefix,
        key_hash: keyHash,
        scopes,
        rate_limit_per_minute: rate,
        expires_at: expiry.value,
        active: true,
        created_by: actor,
      }).select("id,client_id,name,key_prefix,scopes,rate_limit_per_minute,active,expires_at,created_at").single();
      if (error) return apiJson({ ok: false, error: "KEY_CREATE_FAILED" }, 400);

      await auditLog(db, {
        actor,
        action: "platform_api.key.created",
        target: data.id,
        data: { client_id: clientId, key_prefix: keyPrefix, scopes, rate_limit_per_minute: rate, expires_at: expiry.value },
      });
      return apiJson({
        ok: true,
        key: data,
        secret: rawKey,
        warning: "Copy this key now. It will never be displayed again.",
      }, 201);
    }

    if (action === "revoke_key") {
      const keyId = validUuid(body.keyId);
      if (!keyId) return apiJson({ ok: false, error: "INVALID_KEY_ID" }, 400);
      const { data, error } = await db.from("api_keys").update({
        active: false,
        revoked_at: new Date().toISOString(),
      }).eq("id", keyId).select("id,client_id,name,key_prefix,active,revoked_at").maybeSingle();
      if (error) return apiJson({ ok: false, error: "KEY_REVOKE_FAILED" }, 400);
      if (!data) return apiJson({ ok: false, error: "KEY_NOT_FOUND" }, 404);
      await auditLog(db, { actor, action: "platform_api.key.revoked", target: keyId, data: { key_prefix: data.key_prefix } });
      return apiJson({ ok: true, key: data });
    }

    return apiJson({ ok: false, error: "UNKNOWN_ACTION" }, 400);
  } catch (error) {
    await auditLog(db, { actor, action: "platform_api.admin.failed", target: null, data: { error: String(error) } }).catch(() => {});
    return apiJson({ ok: false, error: "INTERNAL_ERROR" }, 500);
  }
});
