// Chargeurs.ch Platform API v1.
// Read-first facade over operational data. Payment and hardware mutations remain
// behind the existing internal Edge Functions until staging validation is complete.

import { adminClient } from "../_shared/db.ts";
import { isChargeNowConfigured } from "../_shared/chargenow.ts";
import {
  PLATFORM_API_VERSION,
  apiCorsHeaders,
  apiJson,
  authenticatePlatformRequest,
  extractApiPath,
  getRequestId,
  hasApiScope,
  logPlatformRequest,
  rateHeaders,
  type PlatformApiPrincipal,
} from "../_shared/platformApi.ts";

const MAX_BODY_BYTES = 64 * 1024;
const SAFE_STATION_FIELDS = [
  "station_id", "name", "location_name", "shop_id", "status", "online", "signal",
  "rentable_count", "returnable_count", "total_count", "last_sync_at", "currency",
].join(",");

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

function uuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function stationIdLike(value: string): boolean {
  return /^[A-Za-z0-9_-]{4,32}$/.test(value);
}

function rentalCodeLike(value: string): boolean {
  return /^CHG-[A-Z0-9]{6,16}$/.test(value);
}

function safeSession(session: Record<string, unknown>) {
  return {
    id: session.id,
    publicSessionCode: session.public_session_code,
    stationId: session.station_id,
    state: session.state,
    currency: session.currency,
    amountExpected: session.amount_expected,
    amountPaid: session.amount_paid,
    startedAt: session.started_at,
    paidAt: session.paid_at,
    ejectedAt: session.ejected_at,
    returnedAt: session.returned_at,
    closedAt: session.closed_at,
    expiresAt: session.expires_at,
    failureCode: session.failure_code,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: apiCorsHeaders });

  const startedAt = Date.now();
  const requestId = getRequestId(req);
  const path = extractApiPath(req);
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
      req, requestId, principal, path, statusCode: status, startedAt, errorCode, metadata,
    });
    return apiJson(body, status, requestId, headers);
  };

  try {
    if (req.method === "GET" && (path === "/v1/health" || path === "/health")) {
      return finish(200, envelope({ ok: true, service: "chargeurs-platform-api", version: PLATFORM_API_VERSION }, requestId));
    }

    const auth = await authenticatePlatformRequest(req, db);
    if (!auth.ok) {
      return finish(auth.status, errorEnvelope(auth.code, auth.message, requestId), auth.code, {}, rateHeaders(auth.rate));
    }
    principal = auth.principal;
    const authRateHeaders = rateHeaders(auth.rate);

    const requireScope = async (scope: string): Promise<Response | null> => {
      if (hasApiScope(principal!, scope)) return null;
      return finish(
        403,
        errorEnvelope("INSUFFICIENT_SCOPE", `Scope ${scope} is required.`, requestId),
        "INSUFFICIENT_SCOPE",
        { requiredScope: scope },
        authRateHeaders,
      );
    };

    if (req.method === "GET" && path === "/v1/me") {
      return finish(200, envelope({
        clientId: principal.clientId,
        clientName: principal.clientName,
        environment: principal.environment,
        scopes: principal.scopes,
        keyPrefix: principal.keyPrefix,
      }, requestId), null, {}, authRateHeaders);
    }

    if (req.method === "GET" && path === "/v1/health/details") {
      const denied = await requireScope("health:read"); if (denied) return denied;
      return finish(200, envelope({
        ok: true,
        dependencies: {
          supabase: true,
          stripeConfigured: Boolean(Deno.env.get("STRIPE_SECRET_KEY")),
          stripeWebhookConfigured: Boolean(Deno.env.get("STRIPE_WEBHOOK_SECRET")),
          chargeNowConfigured: isChargeNowConfigured(),
          chargeNowEventsConfigured: Boolean(Deno.env.get("CHARGENOW_EVENT_SECRET")),
        },
      }, requestId), null, {}, authRateHeaders);
    }

    if (req.method === "GET" && path === "/v1/stations") {
      const denied = await requireScope("stations:read"); if (denied) return denied;
      const url = new URL(req.url);
      const limitValue = Number(url.searchParams.get("limit") ?? 50);
      const limit = Number.isFinite(limitValue) ? Math.max(1, Math.min(100, limitValue)) : 50;
      let query = db.from("stations").select(SAFE_STATION_FIELDS).order("station_id").limit(limit);
      if (url.searchParams.get("online") === "true") query = query.eq("online", true);
      if (url.searchParams.get("online") === "false") query = query.eq("online", false);
      const shopId = (url.searchParams.get("shopId") ?? "").trim();
      if (shopId) query = query.eq("shop_id", shopId);
      const { data, error } = await query;
      if (error) return finish(500, errorEnvelope("DATABASE_ERROR", "Unable to load stations.", requestId), "DATABASE_ERROR", {}, authRateHeaders);
      return finish(200, envelope({ stations: data ?? [], count: data?.length ?? 0 }, requestId), null, {}, authRateHeaders);
    }

    const stationMatch = path.match(/^\/v1\/stations\/([^/]+)$/);
    if (req.method === "GET" && stationMatch) {
      const denied = await requireScope("stations:read"); if (denied) return denied;
      const stationId = decodeURIComponent(stationMatch[1]);
      if (!stationIdLike(stationId)) return finish(400, errorEnvelope("INVALID_STATION_ID", "Invalid station identifier.", requestId), "INVALID_STATION_ID", {}, authRateHeaders);
      const { data, error } = await db.from("stations").select(SAFE_STATION_FIELDS).eq("station_id", stationId).maybeSingle();
      if (error) return finish(500, errorEnvelope("DATABASE_ERROR", "Unable to load station.", requestId), "DATABASE_ERROR", { stationId }, authRateHeaders);
      if (!data) return finish(404, errorEnvelope("STATION_NOT_FOUND", "Station not found.", requestId), "STATION_NOT_FOUND", { stationId }, authRateHeaders);
      return finish(200, envelope({ station: data }, requestId), null, { stationId }, authRateHeaders);
    }

    const availabilityMatch = path.match(/^\/v1\/stations\/([^/]+)\/availability$/);
    if (req.method === "GET" && availabilityMatch) {
      const denied = await requireScope("stations:read"); if (denied) return denied;
      const stationId = decodeURIComponent(availabilityMatch[1]);
      if (!stationIdLike(stationId)) return finish(400, errorEnvelope("INVALID_STATION_ID", "Invalid station identifier.", requestId), "INVALID_STATION_ID", {}, authRateHeaders);
      const [{ data: station }, { data: slots }] = await Promise.all([
        db.from("stations").select(SAFE_STATION_FIELDS).eq("station_id", stationId).maybeSingle(),
        db.from("slots").select("slot_num,status").eq("station_id", stationId).order("slot_num"),
      ]);
      if (!station) return finish(404, errorEnvelope("STATION_NOT_FOUND", "Station not found.", requestId), "STATION_NOT_FOUND", { stationId }, authRateHeaders);
      return finish(200, envelope({ station, slots: slots ?? [] }, requestId), null, { stationId }, authRateHeaders);
    }

    const inventoryMatch = path.match(/^\/v1\/stations\/([^/]+)\/inventory$/);
    if (req.method === "GET" && inventoryMatch) {
      const denied = await requireScope("inventory:read"); if (denied) return denied;
      const stationId = decodeURIComponent(inventoryMatch[1]);
      if (!stationIdLike(stationId)) return finish(400, errorEnvelope("INVALID_STATION_ID", "Invalid station identifier.", requestId), "INVALID_STATION_ID", {}, authRateHeaders);
      const [{ data: station }, { data: slots }, { data: batteries }] = await Promise.all([
        db.from("stations").select(SAFE_STATION_FIELDS).eq("station_id", stationId).maybeSingle(),
        db.from("slots").select("slot_num,status,battery_id").eq("station_id", stationId).order("slot_num"),
        db.from("batteries").select("battery_id,slot_num,status,power_level").eq("station_id", stationId).order("slot_num"),
      ]);
      if (!station) return finish(404, errorEnvelope("STATION_NOT_FOUND", "Station not found.", requestId), "STATION_NOT_FOUND", { stationId }, authRateHeaders);
      return finish(200, envelope({ station, slots: slots ?? [], batteries: batteries ?? [] }, requestId), null, { stationId }, authRateHeaders);
    }

    if (req.method === "POST" && path === "/v1/pricing/quote") {
      const denied = await requireScope("pricing:read"); if (denied) return denied;
      const body = await readJson(req);
      const stationId = typeof body.stationId === "string" ? body.stationId.trim() : null;
      if (stationId && !stationIdLike(stationId)) return finish(400, errorEnvelope("INVALID_STATION_ID", "Invalid station identifier.", requestId), "INVALID_STATION_ID", {}, authRateHeaders);
      const { data, error } = await db.rpc("compute_pricing", {
        p_device: typeof body.deviceId === "string" ? body.deviceId : null,
        p_station: stationId,
        p_shop: typeof body.shopId === "string" ? body.shopId : null,
        p_start: typeof body.startedAt === "string" ? body.startedAt : new Date().toISOString(),
        p_end: typeof body.endedAt === "string" ? body.endedAt : null,
        p_rental_state: typeof body.rentalState === "string" ? body.rentalState : "active",
        p_return_state: typeof body.returnState === "string" ? body.returnState : "normal",
        p_currency: typeof body.currency === "string" ? body.currency : null,
      });
      if (error || !data) {
        const message = String(error?.message ?? "Pricing unavailable.");
        const code = message.includes("PRICING_NOT_CONFIGURED") ? "PRICING_NOT_CONFIGURED" : "PRICING_ERROR";
        return finish(409, errorEnvelope(code, message, requestId), code, { stationId }, authRateHeaders);
      }
      return finish(200, envelope({ quote: data }, requestId), null, { stationId }, authRateHeaders);
    }

    const rentalMatch = path.match(/^\/v1\/rentals\/([^/]+)$/);
    if (req.method === "GET" && rentalMatch) {
      const denied = await requireScope("rentals:read"); if (denied) return denied;
      const identifier = decodeURIComponent(rentalMatch[1]).toUpperCase();
      let query = db.from("rental_sessions").select("*");
      if (uuidLike(identifier)) query = query.eq("id", identifier.toLowerCase());
      else if (rentalCodeLike(identifier)) query = query.eq("public_session_code", identifier);
      else return finish(400, errorEnvelope("INVALID_RENTAL_ID", "Use a rental UUID or public CHG code.", requestId), "INVALID_RENTAL_ID", {}, authRateHeaders);
      const { data, error } = await query.maybeSingle();
      if (error) return finish(500, errorEnvelope("DATABASE_ERROR", "Unable to load rental.", requestId), "DATABASE_ERROR", {}, authRateHeaders);
      if (!data) return finish(404, errorEnvelope("RENTAL_NOT_FOUND", "Rental not found.", requestId), "RENTAL_NOT_FOUND", {}, authRateHeaders);
      return finish(200, envelope({ rental: safeSession(data as Record<string, unknown>) }, requestId), null, { rentalId: data.id }, authRateHeaders);
    }

    const eventMatch = path.match(/^\/v1\/rentals\/([^/]+)\/events$/);
    if (req.method === "GET" && eventMatch) {
      const denied = await requireScope("rentals:read"); if (denied) return denied;
      const rentalId = decodeURIComponent(eventMatch[1]);
      if (!uuidLike(rentalId)) return finish(400, errorEnvelope("INVALID_RENTAL_ID", "Rental UUID required.", requestId), "INVALID_RENTAL_ID", {}, authRateHeaders);
      const { data, error } = await db.from("rental_orchestrator_events")
        .select("id,event_type,occurred_at,resulting_state,resulting_version,created_at")
        .eq("rental_id", rentalId)
        .order("resulting_version");
      if (error) return finish(500, errorEnvelope("DATABASE_ERROR", "Unable to load rental events.", requestId), "DATABASE_ERROR", { rentalId }, authRateHeaders);
      return finish(200, envelope({ rentalId, events: data ?? [] }, requestId), null, { rentalId }, authRateHeaders);
    }

    return finish(404, errorEnvelope("ROUTE_NOT_FOUND", "Unknown Platform API route.", requestId), "ROUTE_NOT_FOUND", {}, authRateHeaders);
  } catch (error) {
    const message = (error as Error).message;
    const code = message === "PAYLOAD_TOO_LARGE" ? "PAYLOAD_TOO_LARGE" : message === "INVALID_JSON" ? "INVALID_JSON" : "INTERNAL_ERROR";
    const status = code === "PAYLOAD_TOO_LARGE" ? 413 : code === "INVALID_JSON" ? 400 : 500;
    return finish(status, errorEnvelope(code, code === "INTERNAL_ERROR" ? "Internal API error." : code, requestId), code);
  }
});
