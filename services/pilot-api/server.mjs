import http from "node:http";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { verifyKioskDevice } from "./lib/auth.mjs";
import { getGuestQuote, getStation } from "./lib/data.mjs";
import { isChargeNowConfigured } from "./lib/chargenow.mjs";
import { readCabinetSnapshot } from "./lib/cabinetSnapshot.mjs";

const { Pool } = pg;
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "0.0.0.0";
const databaseUrl = process.env.DATABASE_URL || "";
const allowedOrigins = new Set(
  String(process.env.PILOT_ALLOWED_ORIGIN || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

const pool = databaseUrl
  ? new Pool({ connectionString: databaseUrl, max: 5, idleTimeoutMillis: 10_000 })
  : null;

function corsHeaders(req) {
  const origin = String(req.headers.origin || "");
  if (!origin || !allowedOrigins.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "content-type,x-kiosk-token,x-idempotency-key,x-request-id",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    Vary: "Origin",
  };
}

function sendJson(req, res, status, body) {
  const requestId = req.headers["x-request-id"] || randomUUID();
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Request-Id": String(requestId),
    ...corsHeaders(req),
  });
  res.end(JSON.stringify({ ...body, requestId }));
}

async function databaseReady() {
  if (!pool) return { ok: false, reason: "DATABASE_URL_MISSING" };
  try {
    const result = await pool.query("select 1 as ok");
    return { ok: result.rows?.[0]?.ok === 1 };
  } catch (error) {
    return { ok: false, reason: "DATABASE_UNAVAILABLE", detail: error instanceof Error ? error.message : "unknown" };
  }
}

async function readJson(req, maxBytes = 32 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error("PAYLOAD_TOO_LARGE"), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("INVALID_JSON"), { statusCode: 400 });
  }
}

function validStationId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{4,32}$/.test(value.trim());
}

async function authenticateStationRequest(req, body) {
  if (!pool) return { ok: false, status: 503, error: "DATABASE_URL_MISSING" };
  const stationId = typeof body.stationId === "string" ? body.stationId.trim() : "";
  if (!validStationId(stationId)) return { ok: false, status: 400, error: "MISSING_STATION" };
  const auth = await verifyKioskDevice(pool, req.headers, stationId);
  if (!auth.ok) return auth;
  return { ok: true, stationId, ...auth };
}

async function handleStation(req, res, body) {
  const auth = await authenticateStationRequest(req, body);
  if (!auth.ok) return sendJson(req, res, auth.status, { ok: false, error: auth.error });
  const station = await getStation(pool, auth.stationId);
  if (!station) return sendJson(req, res, 404, { ok: false, error: "STATION_NOT_FOUND" });
  return sendJson(req, res, 200, { ok: true, station });
}

async function handleQuote(req, res, body) {
  const auth = await authenticateStationRequest(req, body);
  if (!auth.ok) return sendJson(req, res, auth.status, { ok: false, error: auth.error });
  const station = await getStation(pool, auth.stationId);
  if (!station) return sendJson(req, res, 404, { ok: false, error: "STATION_NOT_FOUND" });
  const quote = await getGuestQuote(pool, auth.stationId);
  if (!quote) return sendJson(req, res, 409, { ok: false, error: "PRICING_NOT_CONFIGURED" });
  if (quote.currency !== station.currency) return sendJson(req, res, 409, { ok: false, error: "CURRENCY_MISMATCH" });
  return sendJson(req, res, 200, { ok: true, quote });
}

async function handleCabinetSnapshot(req, res, body) {
  const auth = await authenticateStationRequest(req, body);
  if (!auth.ok) return sendJson(req, res, auth.status, { ok: false, error: auth.error });
  const station = await getStation(pool, auth.stationId);
  if (!station) return sendJson(req, res, 404, { ok: false, error: "STATION_NOT_FOUND" });
  if (!isChargeNowConfigured()) return sendJson(req, res, 409, { ok: false, configured: false, error: "CHARGENOW_NOT_CONFIGURED" });

  const snapshot = await readCabinetSnapshot(station.cabinet_id || station.station_id);
  const slots = snapshot.slots.slice(0, Number(station.total_count || 4)).map((slot) => ({
    slot_num: slot.slot_num,
    charge_percent: slot.status === "return_available" ? null : slot.charge_percent,
    rentable: slot.rentable,
    confidence: slot.confidence,
    status: slot.status,
    recommended: false,
  }));
  const candidates = snapshot.slots
    .filter((slot) => slot.rentable && slot.confidence === "high" && slot.charge_percent != null)
    .sort((a, b) => (b.charge_percent ?? -1) - (a.charge_percent ?? -1) || a.slot_num - b.slot_num);
  const best = slots.find((slot) => slot.slot_num === candidates[0]?.slot_num);
  if (best) {
    best.recommended = true;
    best.status = "recommended";
  }

  const rentableCount = slots.filter((slot) => slot.rentable).length;
  const returnableCount = slots.filter((slot) => slot.status === "return_available").length;
  void pool.query(
    `update stations
        set online = coalesce($2, online), rentable_count = $3, returnable_count = $4,
            last_sync_at = now(), updated_at = now()
      where station_id = $1`,
    [auth.stationId, snapshot.online, rentableCount, returnableCount],
  ).catch(() => undefined);

  return sendJson(req, res, 200, {
    ok: true,
    configured: true,
    online: snapshot.online,
    slots,
    sources: snapshot.sources,
    syncedAt: new Date().toISOString(),
  });
}

const server = http.createServer(async (req, res) => {
  const method = req.method || "GET";
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (method === "OPTIONS") {
    res.writeHead(204, corsHeaders(req));
    res.end();
    return;
  }

  if (method === "GET" && url.pathname === "/health") {
    sendJson(req, res, 200, {
      ok: true,
      service: "chargeurs-pilot-api",
      mode: "guest-only",
      version: "0.2.0",
      chargenowConfigured: isChargeNowConfigured(),
    });
    return;
  }

  if (method === "GET" && url.pathname === "/ready") {
    const db = await databaseReady();
    sendJson(req, res, db.ok ? 200 : 503, {
      ok: db.ok,
      service: "chargeurs-pilot-api",
      database: db,
    });
    return;
  }

  if (method === "POST" && url.pathname.startsWith("/api/kiosk/")) {
    try {
      const body = await readJson(req);
      if (url.pathname === "/api/kiosk/station") return await handleStation(req, res, body);
      if (url.pathname === "/api/kiosk/quote") return await handleQuote(req, res, body);
      if (url.pathname === "/api/kiosk/cabinet-snapshot") return await handleCabinetSnapshot(req, res, body);

      // Financial and hardware mutation routes stay fail-closed until ported.
      return sendJson(req, res, 503, {
        ok: false,
        error: "PILOT_ROUTE_NOT_MIGRATED",
        route: url.pathname,
      });
    } catch (error) {
      const status = Number(error?.statusCode) || 500;
      const publicError = status === 400 || status === 413 ? error.message : "INTERNAL_ERROR";
      console.error(JSON.stringify({ level: "error", event: "pilot_api_request_error", route: url.pathname, error: error instanceof Error ? error.message : String(error) }));
      return sendJson(req, res, status, { ok: false, error: publicError });
    }
  }

  sendJson(req, res, 404, { ok: false, error: "NOT_FOUND" });
});

server.listen(port, host, () => {
  console.log(JSON.stringify({ level: "info", event: "pilot_api_listening", host, port, databaseConfigured: Boolean(databaseUrl) }));
});

async function shutdown(signal) {
  console.log(JSON.stringify({ level: "info", event: "pilot_api_shutdown", signal }));
  server.close(async () => {
    if (pool) await pool.end().catch(() => undefined);
    process.exit(0);
  });
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
