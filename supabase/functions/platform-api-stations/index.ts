// Chargeurs.ch Platform API — station actions.
// Direct endpoint: /functions/v1/platform-api-stations/v1/stations/:id/sync
// This endpoint only refreshes provider state. It never ejects, restarts or
// otherwise controls hardware.

import { adminClient } from "../_shared/db.ts";
import { syncStationFromChargeNow } from "../_shared/stationSync.ts";
import {
  PLATFORM_API_VERSION,
  apiCorsHeaders,
  apiJson,
  authenticatePlatformRequest,
  getRequestId,
  hasApiScope,
  logPlatformRequest,
  rateHeaders,
  type PlatformApiPrincipal,
} from "../_shared/platformApi.ts";
import { extractFunctionApiPath } from "../_shared/platformApiRouting.ts";
import {
  claimPlatformApiIdempotency,
  completePlatformApiIdempotency,
  mutationGate,
  mutationRequestHash,
  readIdempotencyKey,
} from "../_shared/platformApiMutations.ts";

function envelope(data: unknown, requestId: string) {
  return { data, meta: { requestId, apiVersion: PLATFORM_API_VERSION } };
}

function errorEnvelope(code: string, message: string, requestId: string, details?: unknown) {
  return {
    error: { code, message, ...(details === undefined ? {} : { details }) },
    meta: { requestId, apiVersion: PLATFORM_API_VERSION },
  };
}

function stationIdLike(value: string): boolean {
  return /^[A-Za-z0-9_-]{4,32}$/.test(value);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: apiCorsHeaders });

  const startedAt = Date.now();
  const requestId = getRequestId(req);
  const path = extractFunctionApiPath(req, "platform-api-stations");
  const db = adminClient();
  let principal: PlatformApiPrincipal | null = null;

  const finish = async (
    status: number,
    body: unknown,
    errorCode?: string | null,
    metadata: Record<string, unknown> = {},
    headers: Record<string, string> = {},
  ) => {
    await logPlatformRequest(db, {
      req,
      requestId,
      principal,
      path,
      statusCode: status,
      startedAt,
      errorCode,
      metadata,
    });
    return apiJson(body, status, requestId, headers);
  };

  try {
    const auth = await authenticatePlatformRequest(req, db);
    if (!auth.ok) {
      return finish(auth.status, errorEnvelope(auth.code, auth.message, requestId), auth.code, {}, rateHeaders(auth.rate));
    }
    principal = auth.principal;
    const headers = rateHeaders(auth.rate);

    if (!hasApiScope(principal, "stations:write")) {
      return finish(403, errorEnvelope("INSUFFICIENT_SCOPE", "Scope stations:write is required.", requestId), "INSUFFICIENT_SCOPE", {}, headers);
    }

    const match = path.match(/^\/v1\/stations\/([^/]+)\/sync$/);
    if (req.method !== "POST" || !match) {
      return finish(404, errorEnvelope("ROUTE_NOT_FOUND", "Unknown station action route.", requestId), "ROUTE_NOT_FOUND", {}, headers);
    }

    const gate = mutationGate(principal, "database");
    if (!gate.ok) {
      return finish(503, errorEnvelope(gate.code, gate.message, requestId), gate.code, {}, headers);
    }

    const stationId = decodeURIComponent(match[1]);
    if (!stationIdLike(stationId)) {
      return finish(400, errorEnvelope("INVALID_STATION_ID", "Invalid station identifier.", requestId), "INVALID_STATION_ID", {}, headers);
    }

    const idempotencyKey = readIdempotencyKey(req);
    if (!idempotencyKey) {
      return finish(400, errorEnvelope("IDEMPOTENCY_KEY_REQUIRED", "A valid X-Idempotency-Key header is required.", requestId), "IDEMPOTENCY_KEY_REQUIRED", {}, headers);
    }

    const requestHash = await mutationRequestHash(req.method, path, {});
    const claim = await claimPlatformApiIdempotency(db, {
      principal,
      key: idempotencyKey,
      method: req.method,
      path,
      requestHash,
    });

    if (claim.kind === "conflict") {
      return finish(409, errorEnvelope("IDEMPOTENCY_CONFLICT", "This key was already used with a different request.", requestId), "IDEMPOTENCY_CONFLICT", {}, headers);
    }
    if (claim.kind === "in_progress") {
      return finish(409, errorEnvelope("IDEMPOTENCY_IN_PROGRESS", "An identical sync is already running.", requestId), "IDEMPOTENCY_IN_PROGRESS", {}, headers);
    }
    if (claim.kind === "replay") {
      return finish(claim.responseStatus, claim.responseBody, null, { idempotencyReplay: true }, { ...headers, "Idempotency-Replayed": "true" });
    }

    const { data: station, error: stationError } = await db.from("stations")
      .select("station_id,cabinet_id")
      .eq("station_id", stationId)
      .maybeSingle();
    if (stationError || !station) {
      const body = errorEnvelope("STATION_NOT_FOUND", "Station not found.", requestId);
      await completePlatformApiIdempotency(db, {
        recordId: claim.recordId,
        responseStatus: 404,
        responseBody: body,
        resourceType: "station",
        resourceId: stationId,
      });
      return finish(404, body, "STATION_NOT_FOUND", { stationId }, headers);
    }

    const result = await syncStationFromChargeNow(db, station);
    const status = result.ok ? 200 : result.configured ? 502 : 503;
    const body = result.ok
      ? envelope({ sync: result }, requestId)
      : errorEnvelope(result.error, "Station synchronization failed.", requestId, result);

    await completePlatformApiIdempotency(db, {
      recordId: claim.recordId,
      responseStatus: status,
      responseBody: body,
      resourceType: "station",
      resourceId: stationId,
    });

    return finish(status, body, result.ok ? null : result.error, { stationId }, headers);
  } catch (error) {
    return finish(500, errorEnvelope("INTERNAL_ERROR", "Internal station API error.", requestId), "INTERNAL_ERROR", { detail: String(error) });
  }
});
