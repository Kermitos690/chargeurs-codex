// Platform API v1 — public, read-only surface for external integrators.
// Everything here is DEV-ONLY until deployed to the staging project.
// - No writes to rentals, payments, ChargeNow or Stripe are exposed.
// - Rentals reads are strictly scoped to the calling client via
//   rental_sessions.api_client_id (set by future write endpoints).
// - The pricing quote calls the canonical server function compute_pricing;
//   no client-supplied amounts are trusted.
import { adminClient } from "../_shared/db.ts";
import {
  authenticate,
  enforceQuota,
  ensureScope,
  errorResponse,
  jsonResponse,
  logRequest,
  newRequestId,
  platformCorsHeaders,
  type AuthedClient,
  type PlatformApiScope,
} from "../_shared/platformApi.ts";

interface RouteMatch {
  handler: (
    req: Request,
    ctx: RouteContext,
  ) => Promise<Response>;
  scope: PlatformApiScope | null;
  params: Record<string, string>;
}

interface RouteContext {
  db: ReturnType<typeof adminClient>;
  client: AuthedClient;
  requestId: string;
  params: Record<string, string>;
}

type Route = {
  method: "GET" | "POST";
  pattern: RegExp;
  paramNames: string[];
  scope: PlatformApiScope | null; // null = auth only, no scope
  handler: (req: Request, ctx: RouteContext) => Promise<Response>;
};

Deno.serve(async (req) => {
  const requestId = req.headers.get("x-request-id") ?? newRequestId();
  const started = performance.now();

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: platformCorsHeaders });
  }

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/platform-api/, "") || "/";

  const db = adminClient();

  // Unauthenticated routes: /v1/health only.
  if (req.method === "GET" && path === "/v1/health") {
    return finish(db, req, path, 200, requestId, started, null, null, null, {
      status: "ok",
      version: "v1",
      time: new Date().toISOString(),
    });
  }

  const auth = await authenticate(db, req);
  if (!auth.ok) {
    return finish(
      db, req, path, auth.status, requestId, started, null, null, auth.code,
      { error: { code: auth.code, message: auth.message }, request_id: requestId },
    );
  }
  const client = auth.client;

  const match = matchRoute(req.method as "GET" | "POST", path);
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
    }, match.scope ?? undefined);
  }

  try {
    const response = await match.handler(req, {
      db, client, requestId, params: match.params,
    });
    // Persist log with the actual status.
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
    // Attach request id + remaining quota to the response.
    const headers = new Headers(response.headers);
    headers.set("x-request-id", requestId);
    headers.set("x-quota-remaining", String(Math.max(0, quota.remaining)));
    return new Response(response.body, { status: response.status, headers });
  } catch (err) {
    console.error("PLATFORM_API_ERROR", requestId, err instanceof Error ? err.message : "unknown");
    return finish(db, req, path, 500, requestId, started, client.clientId, client.keyId, "internal_error", {
      error: { code: "internal_error", message: "Internal error" },
      request_id: requestId,
    }, match.scope ?? undefined);
  }
});

async function finish(
  db: ReturnType<typeof adminClient>,
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

function clientIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : null;
}

// ---------------------------------------------------------------------------
// Route table
// ---------------------------------------------------------------------------
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

function route(
  method: "GET" | "POST",
  pattern: string,
  scope: PlatformApiScope | null,
  handler: Route["handler"],
): Route {
  const paramNames: string[] = [];
  const rx = new RegExp(
    "^" +
      pattern.replace(/:([A-Za-z_]+)/g, (_m, n) => {
        paramNames.push(n);
        return "([^/]+)";
      }) +
      "$",
  );
  return { method, pattern: rx, paramNames, scope, handler };
}

function matchRoute(method: "GET" | "POST", path: string): RouteMatch | null {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.pattern.exec(path);
    if (!m) continue;
    const params: Record<string, string> = {};
    r.paramNames.forEach((n, i) => (params[n] = decodeURIComponent(m[i + 1])));
    return { handler: r.handler, scope: r.scope, params };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Handlers — all read-only
// ---------------------------------------------------------------------------

async function healthDetails(_req: Request, { db }: RouteContext): Promise<Response> {
  // Only reports coarse booleans; never returns row counts of sensitive tables.
  const chargenowConfigured = Boolean(Deno.env.get("CHARGENOW_BASIC_AUTH"));
  const stripeConfigured = Boolean(Deno.env.get("STRIPE_SECRET_KEY"));
  const { error: dbError } = await db.from("stations").select("station_id").limit(1);
  return jsonResponse({
    status: dbError ? "degraded" : "ok",
    time: new Date().toISOString(),
    dependencies: {
      database: dbError ? "down" : "up",
      chargenow_configured: chargenowConfigured,
      stripe_configured: stripeConfigured,
    },
  });
}

async function me(_req: Request, { client }: RouteContext): Promise<Response> {
  return jsonResponse({
    client_id: client.clientId,
    environment: client.environment,
    scopes: client.scopes,
    quota: {
      per_minute: client.quotaPerMinute,
      per_day: client.quotaPerDay,
    },
  });
}

async function listStations(_req: Request, { db }: RouteContext): Promise<Response> {
  const { data, error } = await db
    .from("stations")
    .select("station_id, name, location_name, online, status, rentable_count, returnable_count, total_count, currency, last_sync_at")
    .order("station_id");
  if (error) return jsonResponse({ error: { code: "db_error", message: "Query failed" } }, 500);
  return jsonResponse({ stations: (data ?? []).map(toStationPublic) });
}

async function getStation(_req: Request, { db, params }: RouteContext): Promise<Response> {
  const { data, error } = await db
    .from("stations")
    .select("station_id, name, location_name, online, status, rentable_count, returnable_count, total_count, currency, last_sync_at")
    .eq("station_id", params.stationId)
    .maybeSingle();
  if (error) return jsonResponse({ error: { code: "db_error", message: "Query failed" } }, 500);
  if (!data) return jsonResponse({ error: { code: "not_found", message: "Station not found" } }, 404);
  return jsonResponse(toStationPublic(data));
}

async function getAvailability(_req: Request, { db, params }: RouteContext): Promise<Response> {
  const { data, error } = await db
    .from("stations")
    .select("station_id, online, rentable_count, returnable_count, total_count, last_sync_at")
    .eq("station_id", params.stationId)
    .maybeSingle();
  if (error) return jsonResponse({ error: { code: "db_error", message: "Query failed" } }, 500);
  if (!data) return jsonResponse({ error: { code: "not_found", message: "Station not found" } }, 404);
  return jsonResponse({
    station_id: data.station_id,
    online: !!data.online,
    rentable: data.rentable_count ?? 0,
    returnable: data.returnable_count ?? 0,
    total_slots: data.total_count ?? 0,
    last_sync_at: data.last_sync_at,
  });
}

async function getInventory(_req: Request, { db, params }: RouteContext): Promise<Response> {
  const { data, error } = await db
    .from("slots")
    .select("slot_num, status, battery_id")
    .eq("station_id", params.stationId)
    .order("slot_num");
  if (error) return jsonResponse({ error: { code: "db_error", message: "Query failed" } }, 500);
  return jsonResponse({
    station_id: params.stationId,
    slots: (data ?? []).map((s) => ({
      slot_num: s.slot_num,
      status: s.status,
      battery_id: s.battery_id ?? null,
    })),
  });
}

async function pricingQuote(req: Request, { db }: RouteContext): Promise<Response> {
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body allowed */ }

  const stationId = typeof body.station_id === "string" ? body.station_id : undefined;
  const deviceId = typeof body.device_id === "string" ? body.device_id : undefined;
  if (!stationId && !deviceId) {
    return jsonResponse({
      error: { code: "invalid_request", message: "station_id or device_id required" },
    }, 400);
  }
  // Canonical pricing — server-side only, ignores any client-supplied amount.
  const { data, error } = await db.rpc("compute_pricing", {
    p_device: deviceId ?? null,
    p_station: stationId ?? null,
    p_shop: null,
    p_start: null,
    p_end: null,
    p_rental_state: "quote",
    p_return_state: "normal",
    p_currency: null,
  });
  if (error) return jsonResponse({ error: { code: "pricing_error", message: error.message } }, 400);
  if (data && typeof data === "object" && "error" in (data as Record<string, unknown>)) {
    return jsonResponse({ error: { code: "pricing_error", message: String((data as Record<string, unknown>).error) } }, 400);
  }
  const quote = data as Record<string, unknown>;
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

async function getRental(_req: Request, { db, client, params }: RouteContext): Promise<Response> {
  const { data, error } = await db
    .from("rental_sessions")
    .select("id, station_id, state, amount_expected, amount_paid, currency, created_at, paid_at, ejected_at, returned_at, closed_at, api_client_id")
    .eq("id", params.rentalId)
    .eq("api_client_id", client.clientId)
    .maybeSingle();
  if (error) return jsonResponse({ error: { code: "db_error", message: "Query failed" } }, 500);
  if (!data) return jsonResponse({ error: { code: "not_found", message: "Rental not found" } }, 404);
  return jsonResponse(toRentalPublic(data));
}

async function getRentalEvents(_req: Request, { db, client, params }: RouteContext): Promise<Response> {
  // Confirm ownership first — never disclose events for another client's rental.
  const { data: rental } = await db
    .from("rental_sessions")
    .select("id")
    .eq("id", params.rentalId)
    .eq("api_client_id", client.clientId)
    .maybeSingle();
  if (!rental) return jsonResponse({ error: { code: "not_found", message: "Rental not found" } }, 404);
  const { data, error } = await db
    .from("rental_events")
    .select("id, event_type, created_at, payload")
    .eq("rental_session_id", params.rentalId)
    .order("created_at", { ascending: true });
  if (error) return jsonResponse({ error: { code: "db_error", message: "Query failed" } }, 500);
  return jsonResponse({
    rental_id: params.rentalId,
    events: (data ?? []).map((e) => ({
      id: e.id,
      type: e.event_type,
      occurred_at: e.created_at,
      // Payload is exposed as-is only for events emitted by the canonical
      // engine; it never contains provider secrets.
      data: sanitizeEventPayload(e.payload),
    })),
  });
}

function toStationPublic(s: Record<string, unknown>) {
  return {
    id: s.station_id,
    name: s.name,
    location: s.location_name,
    online: !!s.online,
    status: s.status,
    rentable: s.rentable_count ?? 0,
    returnable: s.returnable_count ?? 0,
    total_slots: s.total_count ?? 0,
    currency: s.currency ?? "CHF",
    last_sync_at: s.last_sync_at,
  };
}

function toRentalPublic(r: Record<string, unknown>) {
  return {
    id: r.id,
    station_id: r.station_id,
    state: r.state,
    amount_expected: r.amount_expected,
    amount_paid: r.amount_paid,
    currency: r.currency,
    created_at: r.created_at,
    paid_at: r.paid_at,
    ejected_at: r.ejected_at,
    returned_at: r.returned_at,
    closed_at: r.closed_at,
  };
}

const FORBIDDEN_KEYS = new Set([
  "authorization","secret","api_key","apikey","token","password",
  "stripe_secret","stripe_signature","chargenow_auth","raw_data",
]);

function sanitizeEventPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload ?? null;
  const clone: Record<string, unknown> = JSON.parse(JSON.stringify(payload));
  const walk = (o: Record<string, unknown>) => {
    for (const k of Object.keys(o)) {
      if (FORBIDDEN_KEYS.has(k.toLowerCase())) {
        o[k] = "***";
      } else if (o[k] && typeof o[k] === "object") {
        walk(o[k] as Record<string, unknown>);
      }
    }
  };
  walk(clone);
  return clone;
}
