// Chargeurs.ch Platform API v1 — public, read-only integration surface.
// No route in this function creates a rental, changes a payment, calls ChargeNow,
// ejects hardware or mutates the canonical Rental Orchestrator.

import { adminClient } from "../_shared/db.ts";
import {
  PLATFORM_API_VERSION,
  authenticate,
  enforceQuota,
  ensureScope,
  jsonResponse,
  logRequest,
  newRequestId,
  platformCorsHeaders,
  type AuthedClient,
  type PlatformApiScope,
} from "../_shared/platformApi.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATION_ID_RE = /^[A-Za-z0-9_-]{4,32}$/;
const MAX_BODY_BYTES = 64 * 1024;

type Db = ReturnType<typeof adminClient>;
type Handler = (req: Request, context: RouteContext) => Promise<Response>;
type Route = {
  method: "GET" | "POST";
  pattern: RegExp;
  paramNames: string[];
  scope: PlatformApiScope | null;
  handler: Handler;
};
type RouteMatch = Pick<Route, "handler" | "scope"> & { params: Record<string, string> };
type RouteContext = {
  db: Db;
  client: AuthedClient;
  requestId: string;
  params: Record<string, string>;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: platformCorsHeaders });

  const requestId = validRequestId(req.headers.get("x-request-id")) ?? newRequestId();
  const started = performance.now();
  const path = extractPath(req);
  const db = adminClient();

  if (req.method === "GET" && path === "/v1/health") {
    return finish(db, req, path, 200, requestId, started, null, null, null, {
      status: "ok",
      version: PLATFORM_API_VERSION,
      time: new Date().toISOString(),
      mode: "read-only",
    });
  }

  const auth = await authenticate(db, req);
  if (!auth.ok) {
    return finish(db, req, path, auth.status, requestId, started, null, null, auth.code, {
      error: { code: auth.code, message: auth.message },
      request_id: requestId,
    });
  }

  const client = auth.client;
  const match = matchRoute(req.method, path);
  if (!match) {
    return finish(db, req, path, 404, requestId, started, client.clientId, client.keyId, "not_found", {
      error: { code: "not_found", message: "Unknown route" },
      request_id: requestId,
    });
  }

  if (match.scope && !ensureScope(client, match.scope)) {
    return finish(db, req, path, 403, requestId, started, client.clientId, client.keyId, "forbidden_scope", {
      error: { code: "forbidden_scope", message: `Missing scope: ${match.scope}` },
      request_id: requestId,
    }, match.scope);
  }

  const quota = await enforceQuota(db, client);
  if (!quota.ok) {
    return finish(db, req, path, 429, requestId, started, client.clientId, client.keyId, "rate_limited", {
      error: { code: "rate_limited", message: "Quota exceeded" },
      request_id: requestId,
    }, match.scope);
  }

  try {
    const response = await match.handler(req, { db, client, requestId, params: match.params });
    await logRequest(db, {
      client_id: client.clientId,
      key_id: client.keyId,
      method: req.method,
      path,
      status: response.status,
      scope_required: match.scope,
      ip: clientIp(req),
      user_agent: req.headers.get("user-agent"),
      request_id: requestId,
      latency_ms: Math.round(performance.now() - started),
    });
    const headers = new Headers(response.headers);
    headers.set("x-request-id", requestId);
    headers.set("x-quota-remaining", String(Math.max(0, quota.remaining)));
    return new Response(response.body, { status: response.status, headers });
  } catch (error) {
    console.error("PLATFORM_API_ERROR", requestId, error instanceof Error ? error.message : "unknown");
    return finish(db, req, path, 500, requestId, started, client.clientId, client.keyId, "internal_error", {
      error: { code: "internal_error", message: "Internal error" },
      request_id: requestId,
    }, match.scope);
  }
});

function validRequestId(value: string | null): string | null {
  return value && UUID_RE.test(value) ? value : null;
}

function extractPath(req: Request): string {
  const pathname = new URL(req.url).pathname.replace(/\/+$/, "") || "/";
  for (const marker of ["/functions/v1/platform-api", "/platform-api"]) {
    const index = pathname.indexOf(marker);
    if (index >= 0) return pathname.slice(index + marker.length) || "/";
  }
  return pathname;
}

function clientIp(req: Request): string | null {
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? null;
}

async function finish(
  db: Db,
  req: Request,
  path: string,
  status: number,
  requestId: string,
  started: number,
  clientId: string | null,
  keyId: string | null,
  errorCode: string | null,
  body: unknown,
  scope?: string | null,
): Promise<Response> {
  await logRequest(db, {
    client_id: clientId,
    key_id: keyId,
    method: req.method,
    path,
    status,
    scope_required: scope ?? null,
    ip: clientIp(req),
    user_agent: req.headers.get("user-agent"),
    request_id: requestId,
    latency_ms: Math.round(performance.now() - started),
    error_code: errorCode,
  });
  return jsonResponse(body, status, { "x-request-id": requestId });
}

const routes: Route[] = [
  route("GET", "/v1/health/details", "health:read", healthDetails),
  route("GET", "/v1/me", null, me),
  route("GET", "/v1/stations", "stations:read", listStations),
  route("GET", "/v1/stations/:stationId", "stations:read", getStation),
  route("GET", "/v1/stations/:stationId/availability", "inventory:read", getAvailability),
  route("GET", "/v1/stations/:stationId/inventory", "inventory:read", getInventory),
  route("POST", "/v1/pricing/quote", "pricing:read", pricingQuote),
  route("GET", "/v1/rentals/:rentalId", "rentals:read", getRental),
  route("GET", "/v1/rentals/:rentalId/events", "rentals:read", getRentalEvents),
];

function route(method: "GET" | "POST", pattern: string, scope: PlatformApiScope | null, handler: Handler): Route {
  const paramNames: string[] = [];
  const expression = new RegExp("^" + pattern.replace(/:([A-Za-z_]+)/g, (_match, name) => {
    paramNames.push(name);
    return "([^/]+)";
  }) + "$");
  return { method, pattern: expression, paramNames, scope, handler };
}

function matchRoute(method: string, path: string): RouteMatch | null {
  for (const candidate of routes) {
    if (candidate.method !== method) continue;
    const match = candidate.pattern.exec(path);
    if (!match) continue;
    const params: Record<string, string> = {};
    candidate.paramNames.forEach((name, index) => { params[name] = decodeURIComponent(match[index + 1]); });
    return { handler: candidate.handler, scope: candidate.scope, params };
  }
  return null;
}

function apiError(status: number, code: string, message: string): Response {
  return jsonResponse({ error: { code, message } }, status);
}

function validStationId(value: string): boolean {
  return STATION_ID_RE.test(value);
}

function validRentalId(value: string): boolean {
  return UUID_RE.test(value);
}

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return null;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

async function healthDetails(_req: Request, { db }: RouteContext): Promise<Response> {
  const { error: databaseError } = await db.from("stations").select("station_id").limit(1);
  return jsonResponse({
    status: databaseError ? "degraded" : "ok",
    time: new Date().toISOString(),
    dependencies: {
      database: databaseError ? "down" : "up",
      chargenow_configured: Boolean(Deno.env.get("CHARGENOW_BASIC_AUTH") || Deno.env.get("CHARGENOW_BASIC_USERNAME")),
      stripe_configured: Boolean(Deno.env.get("STRIPE_SECRET_KEY")),
    },
  });
}

async function me(_req: Request, { client }: RouteContext): Promise<Response> {
  return jsonResponse({
    client_id: client.clientId,
    environment: client.environment,
    scopes: client.scopes,
    quota: { per_minute: client.quotaPerMinute, per_day: client.quotaPerDay },
  });
}

async function listStations(req: Request, { db }: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const requestedLimit = Number(url.searchParams.get("limit") ?? 50);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(100, Math.trunc(requestedLimit))) : 50;
  let query = db.from("stations")
    .select("station_id,name,location_name,online,status,rentable_count,returnable_count,total_count,currency,last_sync_at")
    .order("station_id")
    .limit(limit);
  if (url.searchParams.get("online") === "true") query = query.eq("online", true);
  if (url.searchParams.get("online") === "false") query = query.eq("online", false);
  const { data, error } = await query;
  if (error) return apiError(500, "db_error", "Unable to load stations");
  return jsonResponse({ stations: (data ?? []).map(toStationPublic), count: data?.length ?? 0 });
}

async function getStation(_req: Request, { db, params }: RouteContext): Promise<Response> {
  if (!validStationId(params.stationId)) return apiError(400, "invalid_station_id", "Invalid station identifier");
  const { data, error } = await db.from("stations")
    .select("station_id,name,location_name,online,status,rentable_count,returnable_count,total_count,currency,last_sync_at")
    .eq("station_id", params.stationId)
    .maybeSingle();
  if (error) return apiError(500, "db_error", "Unable to load station");
  if (!data) return apiError(404, "not_found", "Station not found");
  return jsonResponse(toStationPublic(data));
}

async function getAvailability(_req: Request, { db, params }: RouteContext): Promise<Response> {
  if (!validStationId(params.stationId)) return apiError(400, "invalid_station_id", "Invalid station identifier");
  const { data, error } = await db.from("stations")
    .select("station_id,online,rentable_count,returnable_count,total_count,last_sync_at")
    .eq("station_id", params.stationId)
    .maybeSingle();
  if (error) return apiError(500, "db_error", "Unable to load station availability");
  if (!data) return apiError(404, "not_found", "Station not found");
  return jsonResponse({
    station_id: data.station_id,
    online: Boolean(data.online),
    rentable: data.rentable_count ?? 0,
    returnable: data.returnable_count ?? 0,
    total_slots: data.total_count ?? 0,
    last_sync_at: data.last_sync_at,
  });
}

async function getInventory(_req: Request, { db, params }: RouteContext): Promise<Response> {
  if (!validStationId(params.stationId)) return apiError(400, "invalid_station_id", "Invalid station identifier");
  const [{ data: station, error: stationError }, { data: slots, error: slotError }] = await Promise.all([
    db.from("stations").select("station_id,online,last_sync_at").eq("station_id", params.stationId).maybeSingle(),
    db.from("slots").select("slot_num,status,battery_id").eq("station_id", params.stationId).order("slot_num"),
  ]);
  if (stationError || slotError) return apiError(500, "db_error", "Unable to load station inventory");
  if (!station) return apiError(404, "not_found", "Station not found");
  return jsonResponse({
    station_id: params.stationId,
    online: Boolean(station.online),
    last_sync_at: station.last_sync_at,
    slots: (slots ?? []).map((slot) => ({
      slot_num: slot.slot_num,
      status: slot.status,
      battery_id: slot.battery_id ?? null,
    })),
  });
}

async function pricingQuote(req: Request, { db }: RouteContext): Promise<Response> {
  const body = await readJson(req);
  if (!body) return apiError(400, "invalid_request", "A valid JSON body under 64 KiB is required");
  const stationId = typeof body.station_id === "string" ? body.station_id.trim() : null;
  const deviceId = typeof body.device_id === "string" ? body.device_id.trim() : null;
  if (!stationId && !deviceId) return apiError(400, "invalid_request", "station_id or device_id is required");
  if (stationId && !validStationId(stationId)) return apiError(400, "invalid_station_id", "Invalid station identifier");
  if (deviceId && !validStationId(deviceId)) return apiError(400, "invalid_device_id", "Invalid device identifier");

  const { data, error } = await db.rpc("compute_pricing", {
    p_device: deviceId,
    p_station: stationId,
    p_shop: null,
    p_start: null,
    p_end: null,
    p_rental_state: "quote",
    p_return_state: "normal",
    p_currency: null,
  });
  if (error || !data) return apiError(409, "pricing_unavailable", "Canonical pricing is unavailable");
  const quote = data as Record<string, unknown>;
  if (quote.error) return apiError(409, "pricing_unavailable", "Canonical pricing is unavailable");
  return jsonResponse({
    currency: quote.currency,
    period_minutes: quote.period_minutes,
    initial_fee_cents: quote.initial_fee_cents,
    period_price_cents: quote.duration_cents,
    total_cents: quote.final_cents,
    deposit_cents: quote.deposit_cents,
    profile_id: quote.profile_id,
    profile_version: quote.profile_version,
    computed_at: quote.computed_at,
  });
}

async function loadOwnedRental(db: Db, clientId: string, rentalId: string) {
  if (!validRentalId(rentalId)) return { invalid: true, rental: null, error: null };
  const { data, error } = await db.from("rental_sessions")
    .select("id,station_id,state,amount_expected,amount_paid,currency,created_at,paid_at,ejected_at,returned_at,closed_at,api_client_id")
    .eq("id", rentalId)
    .eq("api_client_id", clientId)
    .maybeSingle();
  return { invalid: false, rental: data, error };
}

async function getRental(_req: Request, { db, client, params }: RouteContext): Promise<Response> {
  const owned = await loadOwnedRental(db, client.clientId, params.rentalId);
  if (owned.invalid) return apiError(400, "invalid_rental_id", "Rental UUID required");
  if (owned.error) return apiError(500, "db_error", "Unable to load rental");
  if (!owned.rental) return apiError(404, "not_found", "Rental not found");

  const { data: snapshot, error: snapshotError } = await db.from("rental_orchestrator_snapshots")
    .select("state,version,station_id,battery_id,final_amount_chf,failure_reason,updated_at")
    .eq("rental_id", params.rentalId)
    .maybeSingle();
  if (snapshotError) return apiError(500, "db_error", "Unable to load canonical rental state");

  return jsonResponse(toRentalPublic(owned.rental, snapshot));
}

async function getRentalEvents(_req: Request, { db, client, params }: RouteContext): Promise<Response> {
  const owned = await loadOwnedRental(db, client.clientId, params.rentalId);
  if (owned.invalid) return apiError(400, "invalid_rental_id", "Rental UUID required");
  if (owned.error) return apiError(500, "db_error", "Unable to verify rental ownership");
  if (!owned.rental) return apiError(404, "not_found", "Rental not found");

  const { data, error } = await db.from("rental_orchestrator_events")
    .select("id,event_type,occurred_at,metadata,resulting_state,resulting_version,created_at")
    .eq("rental_id", params.rentalId)
    .order("resulting_version", { ascending: true });
  if (error) return apiError(500, "db_error", "Unable to load canonical rental events");

  return jsonResponse({
    rental_id: params.rentalId,
    source: "rental_orchestrator_events",
    events: (data ?? []).map((event) => ({
      id: event.id,
      type: event.event_type,
      occurred_at: event.occurred_at,
      resulting_state: event.resulting_state,
      version: event.resulting_version,
      data: sanitizeEventMetadata(event.metadata),
    })),
  });
}

function toStationPublic(station: Record<string, unknown>) {
  return {
    id: station.station_id,
    name: station.name,
    location: station.location_name,
    online: Boolean(station.online),
    status: station.status,
    rentable: station.rentable_count ?? 0,
    returnable: station.returnable_count ?? 0,
    total_slots: station.total_count ?? 0,
    currency: station.currency ?? "CHF",
    last_sync_at: station.last_sync_at,
  };
}

function toRentalPublic(rental: Record<string, unknown>, snapshot: Record<string, unknown> | null) {
  return {
    id: rental.id,
    station_id: snapshot?.station_id ?? rental.station_id,
    state: snapshot?.state ?? rental.state,
    orchestrator_version: snapshot?.version ?? null,
    battery_id: snapshot?.battery_id ?? null,
    amount_expected: rental.amount_expected,
    amount_paid: rental.amount_paid,
    final_amount_chf: snapshot?.final_amount_chf ?? null,
    currency: rental.currency,
    failure_reason: snapshot?.failure_reason ?? null,
    created_at: rental.created_at,
    paid_at: rental.paid_at,
    ejected_at: rental.ejected_at,
    returned_at: rental.returned_at,
    closed_at: rental.closed_at,
    canonical_updated_at: snapshot?.updated_at ?? null,
  };
}

const FORBIDDEN_KEYS = new Set([
  "authorization", "secret", "api_key", "apikey", "token", "password",
  "stripe_secret", "stripe_signature", "chargenow_auth", "raw_data",
  "client_secret", "service_role_key", "access_token", "refresh_token",
]);

function sanitizeEventMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeEventMetadata);
  if (!value || typeof value !== "object") return value ?? null;
  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    output[key] = FORBIDDEN_KEYS.has(key.toLowerCase()) ? "***" : sanitizeEventMetadata(nested);
  }
  return output;
}
