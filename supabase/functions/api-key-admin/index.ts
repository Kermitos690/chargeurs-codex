// Super-admin-only management for Chargeurs.ch Platform API clients and keys.
// Raw keys are generated server-side, returned once, never persisted or logged.

import { adminClient, auditLog, requireSuperAdmin } from "../_shared/db.ts";
import {
  generateApiKey,
  jsonResponse,
  platformCorsHeaders,
  sha256Hex,
} from "../_shared/platformApi.ts";
import {
  normalizeClientName,
  normalizeEnvironment,
  normalizeKeyLabel,
  normalizeOwnerEmail,
  normalizeQuota,
  normalizeScopes,
} from "../_shared/apiClientAdmin.ts";

function apiResponse(body: unknown, status = 200): Response {
  return jsonResponse(body, status, { "cache-control": "no-store" });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: platformCorsHeaders });
  if (req.method !== "POST") return apiResponse({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const db = adminClient();
  const actor = await requireSuperAdmin(req, db);
  if (!actor) return apiResponse({ ok: false, error: "FORBIDDEN" }, 403);

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action ?? "");

    if (action === "list") {
      const [{ data: clients, error: clientsError }, { data: keys, error: keysError }] = await Promise.all([
        db.from("api_clients")
          .select("id,name,environment,owner_email,scopes,quota_per_minute,quota_per_day,active,created_at,updated_at,revoked_at")
          .order("created_at", { ascending: false }),
        db.from("api_keys")
          .select("id,client_id,key_prefix,key_public_id,label,last_used_at,created_at,revoked_at")
          .order("created_at", { ascending: false }),
      ]);
      if (clientsError || keysError) {
        return apiResponse({ ok: false, error: "DATABASE_ERROR" }, 500);
      }
      return apiResponse({ ok: true, clients: clients ?? [], keys: keys ?? [] });
    }

    if (action === "create_client") {
      const name = normalizeClientName(body.name);
      const environment = normalizeEnvironment(body.environment);
      const ownerEmailRaw = String(body.ownerEmail ?? "").trim();
      const ownerEmail = normalizeOwnerEmail(ownerEmailRaw);
      const scopes = normalizeScopes(body.scopes);
      const quotaPerMinute = normalizeQuota(body.quotaPerMinute, 60, 10_000);
      const quotaPerDay = normalizeQuota(body.quotaPerDay, 10_000, 1_000_000);

      if (!name) return apiResponse({ ok: false, error: "INVALID_NAME" }, 400);
      if (ownerEmailRaw && !ownerEmail) return apiResponse({ ok: false, error: "INVALID_OWNER_EMAIL" }, 400);
      if (scopes.length === 0) return apiResponse({ ok: false, error: "AT_LEAST_ONE_READ_SCOPE_REQUIRED" }, 400);

      const { data, error } = await db.from("api_clients").insert({
        name,
        environment,
        owner_email: ownerEmail,
        scopes,
        quota_per_minute: quotaPerMinute,
        quota_per_day: quotaPerDay,
        active: true,
        created_by: actor,
      }).select("id,name,environment,owner_email,scopes,quota_per_minute,quota_per_day,active,created_at,revoked_at").single();

      if (error) return apiResponse({ ok: false, error: "CLIENT_CREATE_FAILED" }, 400);
      await auditLog(db, {
        actor,
        action: "platform_api.client.created",
        target: data.id,
        data: { name, environment, scopes, quota_per_minute: quotaPerMinute, quota_per_day: quotaPerDay },
      });
      return apiResponse({ ok: true, client: data }, 201);
    }

    if (action === "set_client_active") {
      const clientId = String(body.clientId ?? "");
      const active = Boolean(body.active);
      const { data, error } = await db.from("api_clients")
        .update({ active, revoked_at: active ? null : new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", clientId)
        .select("id,name,environment,active,updated_at,revoked_at")
        .single();
      if (error) return apiResponse({ ok: false, error: "CLIENT_UPDATE_FAILED" }, 400);
      await auditLog(db, {
        actor,
        action: active ? "platform_api.client.activated" : "platform_api.client.deactivated",
        target: clientId,
        data: {},
      });
      return apiResponse({ ok: true, client: data });
    }

    if (action === "create_key") {
      const clientId = String(body.clientId ?? "");
      const label = normalizeKeyLabel(body.label);
      const { data: client, error: clientError } = await db.from("api_clients")
        .select("id,name,environment,active,revoked_at")
        .eq("id", clientId)
        .maybeSingle();
      if (clientError || !client || !client.active || client.revoked_at) {
        return apiResponse({ ok: false, error: "CLIENT_NOT_FOUND_OR_INACTIVE" }, 404);
      }

      const generated = generateApiKey(client.environment === "live" ? "live" : "test");
      const keyHash = await sha256Hex(generated.raw);
      const { data, error } = await db.from("api_keys").insert({
        client_id: clientId,
        key_prefix: generated.prefix,
        key_public_id: generated.publicId,
        key_hash: keyHash,
        label,
        created_by: actor,
      }).select("id,client_id,key_prefix,key_public_id,label,created_at,revoked_at").single();
      if (error) return apiResponse({ ok: false, error: "KEY_CREATE_FAILED" }, 400);

      await auditLog(db, {
        actor,
        action: "platform_api.key.created",
        target: data.id,
        data: { client_id: clientId, key_prefix: generated.prefix, key_public_id: generated.publicId, label },
      });

      return apiResponse({
        ok: true,
        key: data,
        secret: generated.raw,
        warning: "Copy this key now. It will never be displayed again.",
      }, 201);
    }

    if (action === "revoke_key") {
      const keyId = String(body.keyId ?? "");
      const revokedAt = new Date().toISOString();
      const { data, error } = await db.from("api_keys")
        .update({ revoked_at: revokedAt })
        .eq("id", keyId)
        .is("revoked_at", null)
        .select("id,client_id,key_prefix,key_public_id,label,revoked_at")
        .single();
      if (error) return apiResponse({ ok: false, error: "KEY_REVOKE_FAILED" }, 400);
      await auditLog(db, {
        actor,
        action: "platform_api.key.revoked",
        target: keyId,
        data: { key_prefix: data.key_prefix, key_public_id: data.key_public_id },
      });
      return apiResponse({ ok: true, key: data });
    }

    return apiResponse({ ok: false, error: "UNKNOWN_ACTION" }, 400);
  } catch (error) {
    console.error("API_KEY_ADMIN_ERROR", error instanceof Error ? error.message : "unknown");
    return apiResponse({ ok: false, error: "INTERNAL_ERROR" }, 500);
  }
});
