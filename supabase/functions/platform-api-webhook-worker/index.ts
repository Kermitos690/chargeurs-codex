// Internal worker for signed Platform API webhooks.
// Invoke from Supabase Cron or another trusted scheduler with the dedicated
// worker bearer token. Response bodies are never persisted; only a short hash.

import { adminClient } from "../_shared/db.ts";
import { apiCorsHeaders, apiJson } from "../_shared/platformApi.ts";
import {
  derivePlatformWebhookSecret,
  nextPlatformWebhookAttempt,
  platformWebhookResponseHash,
  signPlatformWebhook,
} from "../_shared/platformWebhooks.ts";

const DELIVERY_TIMEOUT_MS = 10_000;

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index++) result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return result === 0;
}

function authorized(req: Request): boolean {
  const configured = Deno.env.get("PLATFORM_API_WEBHOOK_WORKER_TOKEN") ?? "";
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  return configured.length >= 32 && bearer.length >= 32 && safeEqual(configured, bearer);
}

async function responseSample(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let output = "";
  try {
    while (output.length < 4096) {
      const { value, done } = await reader.read();
      if (done) break;
      output += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return output.slice(0, 4096);
}

type ClaimedJob = {
  job_id: string;
  attempt_count: number;
  endpoint_id: string;
  target_url: string;
  secret_nonce: string;
  event_id: string;
  event_type: string;
  event_created_at: string;
  resource_type: string | null;
  resource_id: string | null;
  payload: Record<string, unknown>;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: apiCorsHeaders });
  if (req.method !== "POST") return apiJson({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  if (!authorized(req)) return apiJson({ ok: false, error: "FORBIDDEN" }, 403);

  const db = adminClient();
  const body = await req.json().catch(() => ({}));
  const batchSize = Math.max(1, Math.min(100, Number(body.batchSize ?? 25)));
  const workerId = `webhook-worker:${crypto.randomUUID()}`;

  try {
    const { data, error } = await db.rpc("claim_platform_api_webhook_jobs", {
      p_limit: batchSize,
      p_worker_id: workerId,
      p_stale_after_seconds: 300,
    });
    if (error) return apiJson({ ok: false, error: "CLAIM_FAILED" }, 500);

    const jobs = (data ?? []) as ClaimedJob[];
    const results: Array<Record<string, unknown>> = [];

    for (const job of jobs) {
      const startedAt = Date.now();
      const timestamp = String(Math.floor(Date.now() / 1000));
      const deliveryBody = JSON.stringify({
        id: job.event_id,
        type: job.event_type,
        createdAt: job.event_created_at,
        resource: {
          type: job.resource_type,
          id: job.resource_id,
        },
        data: job.payload ?? {},
      });

      let success = false;
      let statusCode: number | null = null;
      let errorCode: string | null = null;
      let responseHash: string | null = null;

      try {
        const signingSecret = await derivePlatformWebhookSecret(job.endpoint_id, job.secret_nonce);
        const signature = await signPlatformWebhook(signingSecret, timestamp, job.event_id, deliveryBody);
        const response = await fetch(job.target_url, {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "Chargeurs.ch-Webhook/1.0",
            "X-Chargeurs-Webhook-Id": job.event_id,
            "X-Chargeurs-Webhook-Event": job.event_type,
            "X-Chargeurs-Webhook-Timestamp": timestamp,
            "X-Chargeurs-Webhook-Signature": signature,
          },
          body: deliveryBody,
        });
        statusCode = response.status;
        success = response.status >= 200 && response.status < 300;
        const sample = await responseSample(response);
        responseHash = await platformWebhookResponseHash(sample);
        if (!success) errorCode = `HTTP_${response.status}`;
      } catch (error) {
        const message = String((error as Error).name ?? error);
        errorCode = message === "TimeoutError" ? "DELIVERY_TIMEOUT" : "DELIVERY_NETWORK_ERROR";
      }

      const durationMs = Math.max(0, Date.now() - startedAt);
      const nextAttemptAt = success ? null : nextPlatformWebhookAttempt(job.attempt_count);
      const terminal = !success && nextAttemptAt === null;

      await db.from("api_webhook_attempts").insert({
        job_id: job.job_id,
        attempt_number: job.attempt_count,
        status_code: statusCode,
        duration_ms: durationMs,
        success,
        error_code: errorCode,
        response_hash: responseHash,
      });

      await db.from("api_webhook_jobs").update(success ? {
        status: "delivered",
        delivered_at: new Date().toISOString(),
        locked_at: null,
        locked_by: null,
        last_error: null,
      } : {
        status: terminal ? "dead" : "pending",
        next_attempt_at: nextAttemptAt ?? new Date().toISOString(),
        locked_at: null,
        locked_by: null,
        last_error: errorCode,
      }).eq("id", job.job_id).eq("locked_by", workerId);

      await db.from("api_webhook_endpoints").update(success ? {
        failure_count: 0,
        last_success_at: new Date().toISOString(),
      } : {
        failure_count: Math.max(1, job.attempt_count),
        last_failure_at: new Date().toISOString(),
      }).eq("id", job.endpoint_id);

      results.push({
        jobId: job.job_id,
        eventId: job.event_id,
        success,
        statusCode,
        errorCode,
        terminal,
        nextAttemptAt,
      });
    }

    return apiJson({ ok: true, claimed: jobs.length, results });
  } catch (error) {
    const code = String(error).includes("WEBHOOK_MASTER_SECRET_NOT_CONFIGURED")
      ? "WEBHOOK_MASTER_SECRET_NOT_CONFIGURED"
      : "WORKER_ERROR";
    return apiJson({ ok: false, error: code }, code === "WORKER_ERROR" ? 500 : 503);
  }
});
