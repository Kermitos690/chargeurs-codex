const SUPABASE_ORIGIN = "https://xqepbqnaenoeyfjkjnzl.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_39LXZ2QrezT20u9dqDQX2Q_-yq4GX0d";
const MAX_BODY_BYTES = 2_000_000;

const ALLOWED_PREFIXES = [
  "auth/v1",
  "rest/v1",
  "functions/v1",
  "storage/v1",
];

const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "authorization",
  "content-type",
  "x-client-info",
  "x-supabase-api-version",
  "prefer",
  "range",
  "accept-profile",
  "content-profile",
  "cache-control",
  "x-upsert",
];

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function upstreamPath(pathname) {
  const prefix = "/api/supabase/";
  if (!pathname.startsWith(prefix)) return null;
  const path = pathname.slice(prefix.length);
  if (!path || path.includes("..") || path.includes("\\")) return null;
  if (!ALLOWED_PREFIXES.some((allowed) => path === allowed || path.startsWith(`${allowed}/`))) return null;
  return path;
}

function buildUpstreamHeaders(request) {
  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  // The publishable key is intentionally public and is the same browser key the
  // direct Supabase client uses. Do not ever replace this with a service-role key.
  headers.set("apikey", SUPABASE_PUBLISHABLE_KEY);
  if (!headers.has("authorization")) {
    headers.set("authorization", `Bearer ${SUPABASE_PUBLISHABLE_KEY}`);
  }
  if (!headers.has("accept")) headers.set("accept", "application/json");
  return headers;
}

function buildResponseHeaders(response) {
  const headers = new Headers();
  const contentType = response.headers.get("content-type");
  const location = response.headers.get("location");
  const range = response.headers.get("content-range");
  const preferenceApplied = response.headers.get("preference-applied");

  if (contentType) headers.set("content-type", contentType);
  if (location) headers.set("location", location);
  if (range) headers.set("content-range", range);
  if (preferenceApplied) headers.set("preference-applied", preferenceApplied);
  headers.set("cache-control", "no-store");
  return headers;
}

async function healthCheck() {
  const url = new URL("/auth/v1/settings", SUPABASE_ORIGIN);
  const headers = new Headers({
    accept: "application/json",
    apikey: SUPABASE_PUBLISHABLE_KEY,
    authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
  });

  const started = Date.now();
  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers,
      redirect: "follow",
    });
    const text = await response.text();
    return json({
      ok: response.ok,
      reachable: true,
      upstreamStatus: response.status,
      latencyMs: Date.now() - started,
      contentType: response.headers.get("content-type") || "",
      bodyKind: text.trim().startsWith("{") ? "json" : text.trim().startsWith("<") ? "html" : "text",
    }, response.ok ? 200 : 502);
  } catch (error) {
    return json({
      ok: false,
      reachable: false,
      state: "fetch_failed",
      latencyMs: Date.now() - started,
      message: error instanceof Error ? error.message : String(error),
    }, 502);
  }
}

export async function onRequest(context) {
  const incoming = new URL(context.request.url);

  if (incoming.pathname === "/api/supabase/health") {
    return healthCheck();
  }

  const path = upstreamPath(incoming.pathname);
  if (!path) return json({ error: "supabase_route_not_allowed" }, 404);

  const method = context.request.method.toUpperCase();
  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" },
    });
  }

  if (!["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    return json({ error: "method_not_allowed" }, 405);
  }

  const contentLength = Number(context.request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return json({ error: "body_too_large" }, 413);
  }

  const upstream = new URL(`/${path}`, SUPABASE_ORIGIN);
  upstream.search = incoming.search;

  const headers = buildUpstreamHeaders(context.request);
  const body = method === "GET" || method === "HEAD"
    ? undefined
    : await context.request.arrayBuffer();

  try {
    const response = await fetch(upstream.toString(), {
      method,
      headers,
      body,
      redirect: "follow",
    });

    const responseBody = method === "HEAD" ? null : await response.arrayBuffer();

    return new Response(responseBody, {
      status: response.status,
      statusText: response.statusText,
      headers: buildResponseHeaders(response),
    });
  } catch (error) {
    console.error("Cloudflare Supabase proxy upstream failure", {
      path,
      method,
      error: error instanceof Error ? error.message : String(error),
    });
    return json({
      error: "supabase_upstream_unavailable",
      message: "Le service de compte est momentanément indisponible.",
    }, 502);
  }
}
