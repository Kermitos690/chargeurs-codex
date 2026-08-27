const SUPABASE_ORIGIN = "https://xqepbqnaenoeyfjkjnzl.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_39LXZ2QrezT20u9dqDQX2Q_-yq4GX0d";
const MAX_BODY_BYTES = 2_000_000;

const ALLOWED_PREFIXES = [
  "auth/v1",
  "rest/v1",
  "functions/v1",
  "storage/v1",
];

function json(body, status) {
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

export async function onRequest(context) {
  const incoming = new URL(context.request.url);
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

  const headers = new Headers(context.request.headers);
  headers.delete("host");
  headers.delete("content-length");
  headers.delete("cf-connecting-ip");
  headers.delete("cf-ipcountry");
  headers.delete("cf-ray");
  headers.delete("x-forwarded-for");
  headers.delete("x-forwarded-proto");
  headers.delete("origin");
  headers.delete("referer");
  headers.set("apikey", SUPABASE_PUBLISHABLE_KEY);

  const body = method === "GET" || method === "HEAD"
    ? undefined
    : await context.request.arrayBuffer();

  try {
    const response = await fetch(upstream.toString(), {
      method,
      headers,
      body,
      redirect: "manual",
    });

    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete("access-control-allow-origin");
    responseHeaders.delete("access-control-allow-credentials");
    responseHeaders.set("Cache-Control", "no-store");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("Cloudflare Supabase proxy upstream failure", {
      path,
      method,
      error: error instanceof Error ? error.message : String(error),
    });
    return json({ error: "supabase_upstream_unavailable" }, 502);
  }
}
