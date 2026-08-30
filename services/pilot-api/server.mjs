import http from "node:http";
import { randomUUID } from "node:crypto";
import pg from "pg";

const { Pool } = pg;

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "0.0.0.0";
const databaseUrl = process.env.DATABASE_URL || "";
const allowedOrigin = process.env.PILOT_ALLOWED_ORIGIN || "";

const pool = databaseUrl
  ? new Pool({ connectionString: databaseUrl, max: 5, idleTimeoutMillis: 10_000 })
  : null;

function corsHeaders(req) {
  const origin = req.headers.origin || "";
  if (!allowedOrigin || !origin || origin !== allowedOrigin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "content-type,x-kiosk-token,x-idempotency-key",
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
      version: "0.1.0",
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

  // Deliberate safety gate. Financial and hardware routes are ported one by one
  // and remain unavailable until their existing Chargeurs.ch invariants have
  // been reproduced and tested against the local PostgreSQL copy.
  if (url.pathname.startsWith("/api/kiosk/")) {
    sendJson(req, res, 503, {
      ok: false,
      error: "PILOT_ROUTE_NOT_MIGRATED",
      route: url.pathname,
    });
    return;
  }

  sendJson(req, res, 404, { ok: false, error: "NOT_FOUND" });
});

server.listen(port, host, () => {
  console.log(JSON.stringify({
    level: "info",
    event: "pilot_api_listening",
    host,
    port,
    databaseConfigured: Boolean(databaseUrl),
  }));
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
