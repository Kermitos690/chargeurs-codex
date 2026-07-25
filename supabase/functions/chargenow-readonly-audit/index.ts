import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  collectChargeNowReadonlySnapshot,
  type ProviderAttempt,
} from "../_shared/chargenowReadonlySnapshot.ts";
import { isChargeNowConfigured } from "../_shared/chargenow.ts";
import { adminClient, auditLog, logApi, requireAdmin, snapshotHash } from "../_shared/db.ts";

const functionCorsHeaders = {
  ...corsHeaders,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...functionCorsHeaders, "Content-Type": "application/json" },
});

function stableFailure(attempts: ProviderAttempt[]): string {
  if (attempts.some((attempt) => [401, 403].includes(attempt.result.status))) {
    return "CHARGENOW_AUTH_REJECTED";
  }
  if (attempts.some((attempt) => attempt.result.status === 404)) {
    return "CHARGENOW_DEVICE_NOT_FOUND";
  }
  if (attempts.some((attempt) => attempt.result.status > 0)) {
    return "CHARGENOW_RESPONSE_UNRECOGNIZED";
  }
  return "CHARGENOW_UNREACHABLE";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: functionCorsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const db = adminClient();
  const actor = await requireAdmin(req, db);
  if (!actor) return json({ ok: false, error: "ADMIN_REQUIRED" }, 403);

  if (!isChargeNowConfigured()) {
    return json({ ok: false, configured: false, error: "CHARGENOW_NOT_CONFIGURED" }, 503);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const stationId = typeof body.stationId === "string" && body.stationId.trim()
      ? body.stationId.trim()
      : "DTA21269";
    const allowAll = Deno.env.get("CHARGENOW_READONLY_ALLOW_ALL_STATIONS") === "true";

    if (!allowAll && stationId !== "DTA21269") {
      return json({ ok: false, error: "PILOT_STATION_ONLY", stationId }, 403);
    }

    const { data: station, error: stationError } = await db
      .from("stations")
      .select("station_id, cabinet_id")
      .eq("station_id", stationId)
      .maybeSingle();

    if (stationError) return json({ ok: false, error: "STATION_QUERY_FAILED" }, 500);
    if (!station) return json({ ok: false, error: "STATION_NOT_FOUND", stationId }, 404);

    const cabinetId = typeof station.cabinet_id === "string" && station.cabinet_id.trim()
      ? station.cabinet_id.trim()
      : stationId;

    const collection = await collectChargeNowReadonlySnapshot(stationId, cabinetId);

    for (const attempt of collection.rawAttempts) {
      await logApi(db, {
        service: "chargenow-readonly",
        endpoint: attempt.endpoint,
        method: attempt.method,
        status_code: attempt.result.status,
        request: { stationId, cabinetId, source: attempt.source },
        response: attempt.result.data,
        error: attempt.result.error,
      });
    }

    const hash = await snapshotHash(collection.snapshot);
    await auditLog(db, {
      actor,
      action: "chargenow.readonly_snapshot",
      target: stationId,
      data: {
        cabinetId,
        snapshotHash: hash,
        providerReachable: collection.snapshot.providerReachable,
        stateKnown: collection.snapshot.stateKnown,
        attemptCount: collection.snapshot.attempts.length,
      },
    });

    if (!collection.snapshot.stateKnown) {
      return json({
        ok: false,
        configured: true,
        error: stableFailure(collection.rawAttempts),
        snapshotHash: hash,
        snapshot: collection.snapshot,
      }, 502);
    }

    return json({
      ok: true,
      configured: true,
      readOnly: true,
      snapshotHash: hash,
      snapshot: collection.snapshot,
    });
  } catch (error) {
    console.error(
      "chargenow-readonly-audit failed",
      error instanceof Error ? error.message : "UNKNOWN_ERROR",
    );
    return json({ ok: false, error: "INTERNAL_ERROR" }, 500);
  }
});
