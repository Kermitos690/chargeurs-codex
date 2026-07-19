// platform-api-webhook-dispatcher — durable webhook worker.
//
// Read-only relative to the canonical rental engine: it never mutates
// rental_sessions or ChargeNow/Stripe; it only reads rental_events already
// produced by the canonical engine and delivers signed HTTP POSTs to
// customer-registered endpoints.
//
// Deployment: intended to run as a scheduled task (every minute) OR as a
// manual dry-run. Never deployed automatically. Dry-run is the default.

import { adminClient } from "../_shared/db.ts";
import { signPayload } from "../_shared/platformApi.ts";

const MAX_ATTEMPTS = 8;               // ~10 min total with exponential backoff
const BACKOFF_SECONDS = [10, 30, 60, 120, 300, 600, 1200, 3600];
const HTTP_TIMEOUT_MS = 8_000;

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }
  const body = await req.json().catch(() => ({}));
  const dryRun = body.dry_run !== false; // default true — mutations are opt-in
  const batchSize = Math.min(50, Math.max(1, Number(body.batch_size ?? 20)));

  const db = adminClient();
  const { data: pending, error } = await db
    .from("api_webhook_deliveries")
    .select("id, endpoint_id, event_type, event_id, payload, attempts, api_webhook_endpoints:endpoint_id(url, secret_hash, active, client_id)")
    .eq("status", "pending")
    .lte("next_attempt_at", new Date().toISOString())
    .limit(batchSize);
  if (error) {
    return json({ ok: false, error: error.message });
  }
  const results: Array<Record<string, unknown>> = [];
  for (const d of pending ?? []) {
    const ep = Array.isArray(d.api_webhook_endpoints) ? d.api_webhook_endpoints[0] : d.api_webhook_endpoints;
    if (!ep || !ep.active) {
      results.push({ id: d.id, skipped: "endpoint_inactive" });
      continue;
    }
    const attempt = (d.attempts ?? 0) + 1;
    const bodyStr = JSON.stringify({
      id: d.event_id,
      type: d.event_type,
      data: d.payload,
    });
    // The plaintext secret is never stored; sign with a per-endpoint value
    // provided via env var indirection (staging operator supplies mapping).
    // In dry-run we still compute the signature to prove the wiring.
    const secret = Deno.env.get(`WEBHOOK_SECRET_${ep.client_id}`) ?? "dry-run-placeholder";
    const signature = await signPayload(secret, bodyStr, Math.floor(Date.now() / 1000));

    if (dryRun) {
      results.push({ id: d.id, dryRun: true, signature_prefix: signature.slice(0, 24), url: ep.url });
      continue;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
    let status = 0; let errorText: string | null = null;
    try {
      const resp = await fetch(ep.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-chargeurs-signature": signature,
          "x-chargeurs-event": d.event_type,
        },
        body: bodyStr,
        signal: controller.signal,
      });
      status = resp.status;
      await resp.text();
    } catch (e) {
      errorText = e instanceof Error ? e.message : "network_error";
    } finally {
      clearTimeout(timer);
    }
    const delivered = status >= 200 && status < 300;
    if (delivered) {
      await db.from("api_webhook_deliveries").update({
        status: "delivered", attempts: attempt,
        last_status_code: status, delivered_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", d.id);
    } else if (attempt >= MAX_ATTEMPTS) {
      await db.from("api_webhook_deliveries").update({
        status: "dead", attempts: attempt,
        last_error: errorText ?? `http_${status}`, last_status_code: status || null,
        updated_at: new Date().toISOString(),
      }).eq("id", d.id);
    } else {
      const wait = BACKOFF_SECONDS[Math.min(BACKOFF_SECONDS.length - 1, attempt - 1)];
      await db.from("api_webhook_deliveries").update({
        status: "pending", attempts: attempt,
        last_error: errorText ?? `http_${status}`, last_status_code: status || null,
        next_attempt_at: new Date(Date.now() + wait * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", d.id);
    }
    results.push({ id: d.id, delivered, status, attempts: attempt });
  }
  return json({ ok: true, dryRun, processed: results.length, results });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json" },
  });
}
