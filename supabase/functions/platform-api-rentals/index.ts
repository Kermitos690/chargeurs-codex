// Chargeurs.ch Platform API — rental actions.
// Direct endpoint base: /functions/v1/platform-api-rentals
// Exposes partner-safe rental creation, listing, lookup, checkout and cancellation.
// Physical battery ejection remains internal and is triggered only by the signed
// Stripe webhook after payment confirmation.

import { adminClient } from "../_shared/db.ts";
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
  canAccessRental,
  claimPlatformApiIdempotency,
  completePlatformApiIdempotency,
  mutationGate,
  mutationRequestHash,
  readIdempotencyKey,
  type IdempotencyClaim,
} from "../_shared/platformApiMutations.ts";
import {
  cancelPlatformRental,
  createPlatformCheckout,
  createPlatformRental,
  findPlatformRental,
  safeRentalSession,
} from "../_shared/platformRentalApi.ts";

const MAX_BODY_BYTES = 64 * 1024;

type DB = ReturnType<typeof adminClient>;

function envelope(data: unknown, requestId: string) {
  return { data, meta: { requestId, apiVersion: PLATFORM_API_VERSION } };
}

function errorEnvelope(code: string, message: string, requestId: string, details?: unknown) {
  return {
    error: { code, message, ...(details === undefined ? {} : { details }) },
    meta: { requestId, apiVersion: PLATFORM_API_VERSION },
  };
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) throw new Error("PAYLOAD_TOO_LARGE");
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_JSON");
    return value as Record<string, unknown>;
  } catch {
    throw new Error("INVALID_JSON");
  }
}

async function listRentals(
  db: DB,
  principal: PlatformApiPrincipal,
  req: Request,
): Promise<{ rentals: unknown[]; count: number; nextCursor: string | null }> {
  const url = new URL(req.url);
  const limitValue = Number(url.searchParams.get("limit") ?? 50);
  const limit = Number.isFinite(limitValue) ? Math.max(1, Math.min(100, limitValue)) : 50;
  const broad = hasApiScope(principal, "rentals:read:any");
  let query = db.from("rental_sessions").select("*").order("created_at", { ascending: false }).limit(limit);

  if (!broad) query = query.eq("api_client_id", principal.clientId);
  else {
    const clientId = (url.searchParams.get("clientId") ?? "").trim();
    if (clientId) query = query.eq("api_client_id", clientId);
  }

  const state = (url.searchParams.get("state") ?? "").trim();
  if (state) query = query.eq("state", state);
  const stationId = (url.searchParams.get("stationId") ?? "").trim();
  if (stationId) query = query.eq("station_id", stationId);
  const before = (url.searchParams.get("before") ?? "").trim();
  if (before) query = query.lt("created_at", before);

  const { data, error } = await query;
  if (error) throw new Error(`DATABASE_ERROR:${error.message}`);
  const rentals = (data ?? []).map((row) => safeRentalSession(row as Record<string, unknown>));
  const nextCursor = data && data.length === limit ? String(data[data.length - 1].created_at) : null;
  return { rentals, count: rentals.length, nextCursor };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: apiCorsHeaders });

  const startedAt = Date.now();
  const requestId = getRequestId(req);
  const path = extractFunctionApiPath(req, "platform-api-rentals");
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

    const requireScope = async (scope: string): Promise<Response | null> => {
      if (hasApiScope(principal!, scope)) return null;
      return finish(403, errorEnvelope("INSUFFICIENT_SCOPE", `Scope ${scope} is required.`, requestId), "INSUFFICIENT_SCOPE", { requiredScope: scope }, headers);
    };

    const beginMutation = async (body: Record<string, unknown>): Promise<{ claim?: IdempotencyClaim; response?: Response }> => {
      const key = readIdempotencyKey(req);
      if (!key) {
        return {
          response: await finish(400, errorEnvelope("IDEMPOTENCY_KEY_REQUIRED", "A valid X-Idempotency-Key header is required.", requestId), "IDEMPOTENCY_KEY_REQUIRED", {}, headers),
        };
      }
      const hash = await mutationRequestHash(req.method, path, body);
      const claim = await claimPlatformApiIdempotency(db, {
        principal: principal!,
        key,
        method: req.method,
        path,
        requestHash: hash,
      });
      if (claim.kind === "conflict") {
        return {
          response: await finish(409, errorEnvelope("IDEMPOTENCY_CONFLICT", "This key was already used with a different request.", requestId), "IDEMPOTENCY_CONFLICT", {}, headers),
        };
      }
      if (claim.kind === "in_progress") {
        return {
          response: await finish(409, errorEnvelope("IDEMPOTENCY_IN_PROGRESS", "An identical request is still being processed.", requestId), "IDEMPOTENCY_IN_PROGRESS", {}, headers),
        };
      }
      if (claim.kind === "replay") {
        return {
          response: await finish(claim.responseStatus, claim.responseBody, null, { idempotencyReplay: true }, { ...headers, "Idempotency-Replayed": "true" }),
        };
      }
      return { claim };
    };

    const completeMutation = async (
      claim: IdempotencyClaim,
      status: number,
      body: unknown,
      resourceId?: string,
    ) => {
      if (claim.kind !== "new") return;
      await completePlatformApiIdempotency(db, {
        recordId: claim.recordId,
        responseStatus: status,
        responseBody: body,
        resourceType: resourceId ? "rental" : null,
        resourceId: resourceId ?? null,
      });
    };

    if (req.method === "GET" && path === "/v1/rentals") {
      const denied = await requireScope("rentals:read");
      if (denied) return denied;
      const result = await listRentals(db, principal, req);
      return finish(200, envelope(result, requestId), null, {}, headers);
    }

    if (req.method === "POST" && path === "/v1/rentals") {
      const denied = await requireScope("rentals:write");
      if (denied) return denied;
      const gate = mutationGate(principal, "database");
      if (!gate.ok) return finish(503, errorEnvelope(gate.code, gate.message, requestId), gate.code, {}, headers);

      const body = await readJson(req);
      const begun = await beginMutation(body);
      if (begun.response) return begun.response;
      const claim = begun.claim!;
      const result = await createPlatformRental(db, principal, body, claim.key);
      if (!result.ok) {
        const responseBody = errorEnvelope(result.code, result.message, requestId, result.details);
        await completeMutation(claim, result.status, responseBody);
        return finish(result.status, responseBody, result.code, {}, headers);
      }
      const responseBody = envelope({ rental: safeRentalSession(result.value) }, requestId);
      await completeMutation(claim, 201, responseBody, String(result.value.id));
      return finish(201, responseBody, null, { rentalId: result.value.id }, headers);
    }

    const checkoutMatch = path.match(/^\/v1\/rentals\/([^/]+)\/checkout$/);
    if (req.method === "POST" && checkoutMatch) {
      const denied = await requireScope("payments:write");
      if (denied) return denied;
      const gate = mutationGate(principal, "stripe");
      if (!gate.ok) return finish(503, errorEnvelope(gate.code, gate.message, requestId), gate.code, {}, headers);

      const body = await readJson(req);
      const begun = await beginMutation(body);
      if (begun.response) return begun.response;
      const claim = begun.claim!;
      const session = await findPlatformRental(db, checkoutMatch[1]);
      if (!session) {
        const responseBody = errorEnvelope("RENTAL_NOT_FOUND", "Rental not found.", requestId);
        await completeMutation(claim, 404, responseBody);
        return finish(404, responseBody, "RENTAL_NOT_FOUND", {}, headers);
      }

      const result = await createPlatformCheckout(db, principal, session, claim.key);
      if (!result.ok) {
        const responseBody = errorEnvelope(result.code, result.message, requestId, result.details);
        await completeMutation(claim, result.status, responseBody, String(session.id));
        return finish(result.status, responseBody, result.code, { rentalId: session.id }, headers);
      }

      const responseBody = envelope({
        rentalId: session.id,
        publicSessionCode: result.value.public_session_code,
        checkoutUrl: result.value.checkout_url,
        checkoutId: result.value.checkout_id,
        expiresAt: result.value.expires_at,
        status: result.value.status,
        reused: Boolean(result.value.reused),
      }, requestId);
      await completeMutation(claim, 200, responseBody, String(session.id));
      return finish(200, responseBody, null, { rentalId: session.id }, headers);
    }

    const cancelMatch = path.match(/^\/v1\/rentals\/([^/]+)\/cancel$/);
    if (req.method === "POST" && cancelMatch) {
      const denied = await requireScope("rentals:write");
      if (denied) return denied;
      const gate = mutationGate(principal, "database");
      if (!gate.ok) return finish(503, errorEnvelope(gate.code, gate.message, requestId), gate.code, {}, headers);

      const body = await readJson(req);
      const begun = await beginMutation(body);
      if (begun.response) return begun.response;
      const claim = begun.claim!;
      const session = await findPlatformRental(db, cancelMatch[1]);
      if (!session) {
        const responseBody = errorEnvelope("RENTAL_NOT_FOUND", "Rental not found.", requestId);
        await completeMutation(claim, 404, responseBody);
        return finish(404, responseBody, "RENTAL_NOT_FOUND", {}, headers);
      }

      const result = await cancelPlatformRental(db, principal, session, claim.key, body.reason);
      if (!result.ok) {
        const responseBody = errorEnvelope(result.code, result.message, requestId, result.details);
        await completeMutation(claim, result.status, responseBody, String(session.id));
        return finish(result.status, responseBody, result.code, { rentalId: session.id }, headers);
      }

      const responseBody = envelope({
        rental: safeRentalSession(result.value.rental),
        alreadyCancelled: result.value.alreadyCancelled,
      }, requestId);
      await completeMutation(claim, 200, responseBody, String(session.id));
      return finish(200, responseBody, null, { rentalId: session.id }, headers);
    }

    const eventMatch = path.match(/^\/v1\/rentals\/([^/]+)\/events$/);
    if (req.method === "GET" && eventMatch) {
      const denied = await requireScope("rentals:read");
      if (denied) return denied;
      const session = await findPlatformRental(db, eventMatch[1]);
      if (!session) return finish(404, errorEnvelope("RENTAL_NOT_FOUND", "Rental not found.", requestId), "RENTAL_NOT_FOUND", {}, headers);
      if (!canAccessRental(principal, session, "read")) {
        return finish(403, errorEnvelope("RENTAL_FORBIDDEN", "This API client does not own the rental.", requestId), "RENTAL_FORBIDDEN", { rentalId: session.id }, headers);
      }

      const [{ data: orchestratorEvents, error: orchestratorError }, { data: legacyEvents, error: legacyError }] = await Promise.all([
        db.from("rental_orchestrator_events")
          .select("id,event_type,occurred_at,resulting_state,resulting_version,created_at")
          .eq("rental_id", session.id)
          .order("resulting_version"),
        db.from("rental_events")
          .select("id,type,source,data,created_at")
          .eq("rental_session_id", session.id)
          .order("created_at"),
      ]);
      if (orchestratorError || legacyError) {
        return finish(500, errorEnvelope("DATABASE_ERROR", "Unable to load rental events.", requestId), "DATABASE_ERROR", { rentalId: session.id }, headers);
      }
      return finish(200, envelope({
        rentalId: session.id,
        orchestratorEvents: orchestratorEvents ?? [],
        legacyEvents: legacyEvents ?? [],
      }, requestId), null, { rentalId: session.id }, headers);
    }

    const rentalMatch = path.match(/^\/v1\/rentals\/([^/]+)$/);
    if (req.method === "GET" && rentalMatch) {
      const denied = await requireScope("rentals:read");
      if (denied) return denied;
      const session = await findPlatformRental(db, rentalMatch[1]);
      if (!session) return finish(404, errorEnvelope("RENTAL_NOT_FOUND", "Rental not found.", requestId), "RENTAL_NOT_FOUND", {}, headers);
      if (!canAccessRental(principal, session, "read")) {
        return finish(403, errorEnvelope("RENTAL_FORBIDDEN", "This API client does not own the rental.", requestId), "RENTAL_FORBIDDEN", { rentalId: session.id }, headers);
      }
      return finish(200, envelope({ rental: safeRentalSession(session) }, requestId), null, { rentalId: session.id }, headers);
    }

    return finish(404, errorEnvelope("ROUTE_NOT_FOUND", "Unknown rental API route.", requestId), "ROUTE_NOT_FOUND", {}, headers);
  } catch (error) {
    const message = String((error as Error).message ?? error);
    const code = message === "PAYLOAD_TOO_LARGE"
      ? "PAYLOAD_TOO_LARGE"
      : message === "INVALID_JSON"
      ? "INVALID_JSON"
      : message.startsWith("IDEMPOTENCY_STORAGE_ERROR")
      ? "IDEMPOTENCY_STORAGE_ERROR"
      : "INTERNAL_ERROR";
    const status = code === "PAYLOAD_TOO_LARGE" ? 413 : code === "INVALID_JSON" ? 400 : 500;
    return finish(status, errorEnvelope(code, code === "INTERNAL_ERROR" ? "Internal rental API error." : code, requestId), code, { detail: message });
  }
});
