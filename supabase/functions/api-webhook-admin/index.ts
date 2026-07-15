// Super-admin management for Platform API webhook endpoints.
// Signing secrets are derived from a deployment master secret and endpoint nonce.
// They are returned only on creation or rotation and are never stored raw.

import { adminClient, auditLog, requireSuperAdmin } from "../_shared/db.ts";
import { apiCorsHeaders, apiJson } from "../_shared/platformApi.ts";
import {
  derivePlatformWebhookSecret,
  validatePlatformWebhookUrl,
  webhookEventTypes,
} from "../_shared/platformWebhooks.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: apiCorsHeaders });
  const db = adminClient();
  const actor = await requireSuperAdmin(req, db);
  if (!actor) return apiJson({ ok: false, error: "FORBIDDEN" }, 403);

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");

    if (action === "list") {
      const { data, error } = await db.from("api_webhook_endpoints")
        .select("id,client_id,name,target_url,event_types,active,failure_count,last_success_at,last_failure_at,created_at,updated_at,api_clients!inner(name,environment)")
        .order("created_at", { ascending: false });
      if (error) return apiJson({ ok: false, error: error.message }, 500);
      return apiJson({ ok: true, endpoints: data ?? [] });
    }

    if (action === "create") {
      const clientId = String(body.clientId ?? "");
      const name = String(body.name ?? "").trim();
      const target = validatePlatformWebhookUrl(String(body.targetUrl ?? "").trim());
      if (!clientId) return apiJson({ ok: false, error: "CLIENT_REQUIRED" }, 400);
      if (name.length < 2 || name.length > 120) return apiJson({ ok: false, error: "INVALID_NAME" }, 400);
      if (!target.ok) return apiJson({ ok: false, error: target.code }, 400);

      const { data: client } = await db.from("api_clients")
        .select("id,name,environment,active")
        .eq("id", clientId)
        .maybeSingle();
      if (!client || !client.active) return apiJson({ ok: false, error: "CLIENT_NOT_FOUND_OR_INACTIVE" }, 404);

      const id = crypto.randomUUID();
      const nonce = crypto.randomUUID();
      const eventTypes = webhookEventTypes(body.eventTypes);
      const { data, error } = await db.from("api_webhook_endpoints").insert({
        id,
        client_id: clientId,
        name,
        target_url: target.url,
        event_types: eventTypes,
        active: true,
        secret_nonce: nonce,
        created_by: actor,
      }).select("id,client_id,name,target_url,event_types,active,created_at").single();
      if (error) return apiJson({ ok: false, error: error.message }, 400);

      const signingSecret = await derivePlatformWebhookSecret(id, nonce);
      await auditLog(db, {
        actor,
        action: "platform_api.webhook_endpoint.created",
        target: id,
        data: { client_id: clientId, target_host: new URL(target.url).hostname, event_types: eventTypes },
      });
      return apiJson({
        ok: true,
        endpoint: data,
        signingSecret,
        warning: "Copy this webhook signing secret now. It will not be displayed again.",
      }, 201);
    }

    if (action === "rotate_secret") {
      const endpointId = String(body.endpointId ?? "");
      const nonce = crypto.randomUUID();
      const { data, error } = await db.from("api_webhook_endpoints")
        .update({ secret_nonce: nonce })
        .eq("id", endpointId)
        .select("id,client_id,name,target_url,event_types,active,updated_at")
        .single();
      if (error) return apiJson({ ok: false, error: error.message }, 400);
      const signingSecret = await derivePlatformWebhookSecret(endpointId, nonce);
      await auditLog(db, {
        actor,
        action: "platform_api.webhook_endpoint.secret_rotated",
        target: endpointId,
        data: { client_id: data.client_id },
      });
      return apiJson({
        ok: true,
        endpoint: data,
        signingSecret,
        warning: "Replace the previous signing secret immediately.",
      });
    }

    if (action === "set_active") {
      const endpointId = String(body.endpointId ?? "");
      const active = Boolean(body.active);
      const { data, error } = await db.from("api_webhook_endpoints")
        .update({ active })
        .eq("id", endpointId)
        .select("id,client_id,name,target_url,event_types,active,updated_at")
        .single();
      if (error) return apiJson({ ok: false, error: error.message }, 400);
      await auditLog(db, {
        actor,
        action: active ? "platform_api.webhook_endpoint.activated" : "platform_api.webhook_endpoint.deactivated",
        target: endpointId,
        data: { client_id: data.client_id },
      });
      return apiJson({ ok: true, endpoint: data });
    }

    if (action === "update") {
      const endpointId = String(body.endpointId ?? "");
      const patch: Record<string, unknown> = {};
      if (typeof body.name === "string") {
        const name = body.name.trim();
        if (name.length < 2 || name.length > 120) return apiJson({ ok: false, error: "INVALID_NAME" }, 400);
        patch.name = name;
      }
      if (typeof body.targetUrl === "string") {
        const target = validatePlatformWebhookUrl(body.targetUrl.trim());
        if (!target.ok) return apiJson({ ok: false, error: target.code }, 400);
        patch.target_url = target.url;
      }
      if (body.eventTypes !== undefined) patch.event_types = webhookEventTypes(body.eventTypes);
      if (Object.keys(patch).length === 0) return apiJson({ ok: false, error: "NO_CHANGES" }, 400);

      const { data, error } = await db.from("api_webhook_endpoints")
        .update(patch)
        .eq("id", endpointId)
        .select("id,client_id,name,target_url,event_types,active,updated_at")
        .single();
      if (error) return apiJson({ ok: false, error: error.message }, 400);
      await auditLog(db, {
        actor,
        action: "platform_api.webhook_endpoint.updated",
        target: endpointId,
        data: { client_id: data.client_id, fields: Object.keys(patch) },
      });
      return apiJson({ ok: true, endpoint: data });
    }

    return apiJson({ ok: false, error: "UNKNOWN_ACTION" }, 400);
  } catch (error) {
    const message = String((error as Error).message ?? error);
    const code = message.includes("WEBHOOK_MASTER_SECRET_NOT_CONFIGURED")
      ? "WEBHOOK_MASTER_SECRET_NOT_CONFIGURED"
      : "INTERNAL_ERROR";
    return apiJson({ ok: false, error: code }, code === "INTERNAL_ERROR" ? 500 : 503);
  }
});
