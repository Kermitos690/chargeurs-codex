import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, sha256Hex, verifyKioskDevice } from "../_shared/db.ts";

const MAX_BODY_BYTES = 512 * 1024;
const MAX_DEPTH = 12;
const SENSITIVE_KEY = /(authorization|cookie|credential|password|secret|token|private.?key)/i;

const functionCorsHeaders = {
  ...corsHeaders,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-kiosk-token, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...functionCorsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function redactSensitive(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "[TRUNCATED_DEPTH]";
  if (Array.isArray(value)) return value.slice(0, 500).map((item) => redactSensitive(item, depth + 1));
  if (!isRecord(value)) return value;

  const redacted: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, 1_000)) {
    redacted[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactSensitive(item, depth + 1);
  }
  return redacted;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: functionCorsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const declaredLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return json({ ok: false, error: "REPORT_TOO_LARGE" }, 413);
  }

  const rawBody = await req.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return json({ ok: false, error: "REPORT_TOO_LARGE" }, 413);
  }

  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawBody);
    if (!isRecord(parsed)) return json({ ok: false, error: "INVALID_BODY" }, 400);
    body = parsed;
  } catch {
    return json({ ok: false, error: "INVALID_JSON" }, 400);
  }

  const stationId = typeof body.stationId === "string" ? body.stationId.trim() : "";
  const devicePublicId = typeof body.devicePublicId === "string" ? body.devicePublicId.trim() : "";
  const appVersion = typeof body.appVersion === "string" ? body.appVersion.trim() : "";
  const sequence = typeof body.sequence === "number" ? body.sequence : Number.NaN;
  const mode = body.mode === "shadow" ? "shadow" : "";

  if (!stationId || !devicePublicId || !appVersion || !Number.isSafeInteger(sequence) || sequence < 0 || !mode) {
    return json({ ok: false, error: "INVALID_REPORT_METADATA" }, 400);
  }
  if (!isRecord(body.report)) return json({ ok: false, error: "INVALID_REPORT" }, 400);

  const db = adminClient();
  const auth = await verifyKioskDevice(req, db, stationId);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const report = redactSensitive(body.report);
  const reportSha256 = await sha256Hex(JSON.stringify(report));

  const { data: provider } = await db
    .from("stations")
    .select("status, online, signal, rentable_count, returnable_count, total_count, last_sync_at, raw_data")
    .eq("station_id", stationId)
    .maybeSingle();

  const providerSnapshot = provider
    ? {
        status: provider.status,
        online: provider.online,
        signal: provider.signal,
        rentableCount: provider.rentable_count,
        returnableCount: provider.returnable_count,
        totalCount: provider.total_count,
        rawData: provider.raw_data,
      }
    : null;

  const { data: inserted, error } = await db
    .from("local_gateway_observations")
    .insert({
      station_id: stationId,
      kiosk_device_id: auth.device.id,
      device_public_id: devicePublicId,
      app_version: appVersion,
      sequence,
      mode,
      report_sha256: reportSha256,
      report,
      provider_snapshot: providerSnapshot,
      provider_last_sync_at: provider?.last_sync_at ?? null,
    })
    .select("id, received_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      return json({ ok: true, duplicate: true, reportSha256 });
    }
    console.error("device-shadow-ingest insert failed", error.code ?? "UNKNOWN_DB_ERROR");
    return json({ ok: false, error: "REPORT_STORE_FAILED" }, 500);
  }

  return json({
    ok: true,
    observationId: inserted.id,
    receivedAt: inserted.received_at,
    reportSha256,
    providerSnapshotCaptured: providerSnapshot !== null,
  });
});
