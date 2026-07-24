import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, requireAdmin, verifyKioskDevice } from "../_shared/db.ts";

const functionCorsHeaders = {
  ...corsHeaders,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-kiosk-token, x-supabase-api-version",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...functionCorsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
});

function routePath(req: Request): string {
  const pathname = new URL(req.url).pathname;
  const marker = "/local-gateway-api";
  const index = pathname.indexOf(marker);
  return index < 0 ? "/" : pathname.slice(index + marker.length) || "/";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: functionCorsHeaders });
  if (req.method !== "GET") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const path = routePath(req);
  if (path === "/v1/capabilities") {
    return json({
      ok: true,
      api: "chargeurs-local-gateway",
      version: "v1",
      mode: "shadow",
      capabilities: {
        localObservation: true,
        providerSnapshotComparison: true,
        localSerialRead: false,
        localHardwareControl: false,
        localEjection: false,
        localReturnDetection: false,
      },
    });
  }

  const match = path.match(/^\/v1\/stations\/([A-Za-z0-9_-]{4,32})\/status$/);
  if (!match) return json({ ok: false, error: "ROUTE_NOT_FOUND" }, 404);

  const stationId = match[1];
  const db = adminClient();
  const adminId = await requireAdmin(req, db);
  if (!adminId) {
    const auth = await verifyKioskDevice(req, db, stationId);
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  }

  const { data: station, error: stationError } = await db
    .from("stations")
    .select("station_id, cabinet_id, status, online, signal, rentable_count, returnable_count, total_count, last_sync_at")
    .eq("station_id", stationId)
    .maybeSingle();
  if (stationError) return json({ ok: false, error: "STATION_QUERY_FAILED" }, 500);
  if (!station) return json({ ok: false, error: "STATION_NOT_FOUND" }, 404);

  const { data: observation, error: observationError } = await db
    .from("local_gateway_observations")
    .select("id, device_public_id, app_version, sequence, mode, report_sha256, report, provider_snapshot, provider_last_sync_at, received_at")
    .eq("station_id", stationId)
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (observationError) return json({ ok: false, error: "OBSERVATION_QUERY_FAILED" }, 500);

  return json({
    ok: true,
    source: observation ? "local_shadow" : "provider_only",
    mode: "shadow",
    controlEnabled: false,
    controlDisabledReason: "LOCAL_PROTOCOL_NOT_VALIDATED",
    station: {
      stationId: station.station_id,
      cabinetId: station.cabinet_id,
      status: station.status,
      online: station.online,
      signal: station.signal,
      rentableCount: station.rentable_count,
      returnableCount: station.returnable_count,
      totalCount: station.total_count,
      providerLastSyncAt: station.last_sync_at,
    },
    latestLocalObservation: observation
      ? {
          id: observation.id,
          devicePublicId: observation.device_public_id,
          appVersion: observation.app_version,
          sequence: observation.sequence,
          mode: observation.mode,
          reportSha256: observation.report_sha256,
          receivedAt: observation.received_at,
          report: observation.report,
          providerSnapshot: observation.provider_snapshot,
          providerLastSyncAt: observation.provider_last_sync_at,
        }
      : null,
  });
});
