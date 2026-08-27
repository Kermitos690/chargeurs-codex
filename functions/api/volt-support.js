const PUBLIC_CONTACT_URL = "https://xqepbqnaenoeyfjkjnzl.supabase.co/functions/v1/public-contact";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function isCloudflareProjectHost(request) {
  const host = new URL(request.url).hostname;
  return host === "chargeurs-ch-staging-cf.pages.dev" || host.endsWith(".chargeurs-ch-staging-cf.pages.dev");
}

export async function onRequest(context) {
  const method = context.request.method.toUpperCase();
  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" },
    });
  }
  if (method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  if (!isCloudflareProjectHost(context.request)) return json({ ok: false, error: "HOST_FORBIDDEN" }, 403);

  const requestUrl = new URL(context.request.url);
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  headers.set("Origin", `https://${requestUrl.hostname}`);

  const authorization = context.request.headers.get("Authorization");
  if (authorization) headers.set("Authorization", authorization);
  const clientInfo = context.request.headers.get("x-client-info");
  if (clientInfo) headers.set("x-client-info", clientInfo);
  const clientIp = context.request.headers.get("CF-Connecting-IP") || context.request.headers.get("x-forwarded-for");
  if (clientIp) headers.set("x-forwarded-for", clientIp.split(",")[0].trim());

  const body = await context.request.arrayBuffer();
  try {
    const upstream = await fetch(PUBLIC_CONTACT_URL, {
      method: "POST",
      headers,
      body,
      redirect: "manual",
    });

    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.set("Cache-Control", "no-store");
    responseHeaders.delete("Access-Control-Allow-Origin");
    responseHeaders.delete("Access-Control-Allow-Headers");
    responseHeaders.delete("Access-Control-Allow-Methods");

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("Cloudflare Volt proxy upstream failure", error instanceof Error ? error.message : String(error));
    return json({ ok: false, error: "SUPPORT_UPSTREAM_UNAVAILABLE" }, 502);
  }
}
