// Super-admin-only management for Chargeurs.ch Platform API clients and keys.
// Raw API keys are returned once when created and are never stored or logged.

import { adminClient, auditLog, requireSuperAdmin } from "../_shared/db.ts";
import { apiCorsHeaders, apiJson, sha256Hex } from "../_shared/platformApi.ts";

const ALLOWED_SCOPES = new Set([
  "*",
  "health:read",
  "stations:read",
  "inventory:read",
  "pricing:read",
  "rentals:read",
  "rentals:write",
  "payments:write",
  "stations:write",
]);

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: apiCorsHeaders });
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
      if (error) return apiJson({ ok: false, error: error.message }, 500);
      return apiJson({ ok: true, clients: data ?? [] });
    }

    if (action === "create_client") {
      const name = String(body.name ?? "").trim();
      const environment = body.environment === "live" ? "live" : "test";
      if (name.length < 2 || name.length > 120) return apiJson({ ok: false, error: "INVALID_NAME" }, 400);
      const { data, error } = await db.from("api_clients").insert({
        name,
        environment,
        active: true,
        contact_email: body.contactEmail ? String(body.contactEmail).trim().slice(0, 320) : null,
        description: body.description ? String(body.description).trim().slice(0, 2000) : null,
        metadata: body.metadata && typeof body.metadata === "object" ? body.metadata : {},
        created_by: actor,
      }).select("id,name,environment,active,created_at").single();
      if (error) return apiJson({ ok: false, error: error.message }, 400);
      await auditLog(db, { actor, action: "platform_api.client.created", target: data.id, data: { name, environment } });
      return apiJson({ ok: true, client: data }, 201);
    }

    if (action === "set_client_active") {
      const clientId = String(body.clientId ?? "");
      const active = Boolean(body.active);
      const { data, error } = await db.from("api_clients").update({ active }).eq("id", clientId)
        .select("id,name,environment,active,updated_at").single();
      if (error) return apiJson({ ok: false, error: error.message }, 400);
      await auditLog(db, { actor, action: active ? "platform_api.client.activated" : "platform_api.client.deactivated", target: clientId, data: {} });
      return apiJson({ ok: true, client: data });
    }

    if (action === "create_key") {
      const clientId = String(body.clientId ?? "");
      const { data: client } = await db.from("api_clients").select("id,name,environment,active").eq("id", clientId).maybeSingle();
      if (!client || !client.active) return apiJson({ ok: false, error: "CLIENT_NOT_FOUND_OR_INACTIVE" }, 404);

      const scopes = cleanScopes(body.scopes);
      if (scopes.length === 0) return apiJson({ ok: false, error: "AT_LEAST_ONE_VALID_SCOPE_REQUIRED" }, 400);
      const rate = Math.max(1, Math.min(10000, Number(body.rateLimitPerMinute ?? 120)));
      const rawKey = `chg_${client.environment}_${randomToken(32)}`;
      const keyPrefix = rawKey.slice(0, 22);
      const keyHash = await sha256Hex(rawKey);
      const expiresAt = body.expiresAt ? new Date(String(body.expiresAt)).toISOString() : null;

      const { data, error } = await db.from("api_keys").insert({
        client_id: clientId,
        name: String(body.name ?? "Default key").trim().slice(0, 120) || "Default key",
        key_prefix: keyPrefix,
        key_hash: keyHash,
        scopes,
        rate_limit_per_minute: rate,
        expires_at: expiresAt,
        active: true,
        created_by: actor,
      }).select("id,client_id,name,key_prefix,scopes,rate_limit_per_minute,active,expires_at,created_at").single();
      if (error) return apiJson({ ok: false, error: error.message }, 400);

      await auditLog(db, {
        actor,
        action: "platform_api.key.created",
        target: data.id,
        data: { client_id: clientId, key_prefix: keyPrefix, scopes, rate_limit_per_minute: rate, expires_at: expiresAt },
      });
      return apiJson({
        ok: true,
        key: data,
        secret: rawKey,
        warning: "Copy this key now. It will never be displayed again.",
      }, 201);
    }

    if (action === "revoke_key") {
      const keyId = String(body.keyId ?? "");
      const { data, error } = await db.from("api_keys").update({
        active: false,
        revoked_at: new Date().toISOString(),
      }).eq("id", keyId).select("id,client_id,name,key_prefix,active,revoked_at").single();
      if (error) return apiJson({ ok: false, error: error.message }, 400);
      await auditLog(db, { actor, action: "platform_api.key.revoked", target: keyId, data: { key_prefix: data.key_prefix } });
      return apiJson({ ok: true, key: data });
    }

    return apiJson({ ok: false, error: "UNKNOWN_ACTION" }, 400);
  } catch (error) {
    return apiJson({ ok: false, error: "INTERNAL_ERROR", detail: String(error) }, 500);
  }
});
