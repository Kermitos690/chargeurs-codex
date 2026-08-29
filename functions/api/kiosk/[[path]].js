const SUPABASE_FUNCTIONS_ORIGIN = "https://xqepbqnaenoeyfjkjnzl.supabase.co/functions/v1";

const KIOSK_ROUTE_MAP = Object.freeze({
  "/api/kiosk/create-rental-session": "create-rental-session",
  "/api/kiosk/create-stripe-checkout": "create-stripe-checkout",
  "/api/kiosk/cancel-checkout": "cancel-kiosk-checkout",
  "/api/kiosk/terminal-payment": "stripe-terminal-backend",
  "/api/kiosk/cabinet-snapshot": "kiosk-cabinet-snapshot",
  "/api/kiosk/reconcile-pending-ejection": "reconcile-pending-ejection",
  "/api/kiosk/return-summary": "kiosk-return-summary",
  "/api/kiosk/resume-state": "kiosk-resume-state",
  "/api/kiosk/customer-options": "kiosk-customer-options",
  "/api/kiosk/customer-pairing-create": "customer-pairing-create",
  "/api/kiosk/customer-pairing-status": "customer-pairing-status",
  "/api/kiosk/ads-clock": "kiosk-ads-clock",
  "/api/kiosk/ads-playlist": "kiosk-ads-playlist",
});

function normalizePath(pathname) {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

export async function onRequest(context) {
  const incomingUrl = new URL(context.request.url);
  const route = normalizePath(incomingUrl.pathname);
  const functionName = KIOSK_ROUTE_MAP[route];

  if (!functionName) {
    return new Response("Not Found", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const upstreamUrl = new URL(`${SUPABASE_FUNCTIONS_ORIGIN}/${functionName}`);
  upstreamUrl.search = incomingUrl.search;

  const headers = new Headers(context.request.headers);
  headers.delete("host");
  headers.delete("content-length");

  const method = context.request.method.toUpperCase();
  const body = method === "GET" || method === "HEAD"
    ? undefined
    : await context.request.arrayBuffer();

  try {
    const upstream = await fetch(upstreamUrl.toString(), {
      method,
      headers,
      body,
      redirect: "manual",
    });

    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.set("Cache-Control", "no-store");

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("Cloudflare kiosk proxy upstream failure", {
      route,
      functionName,
      error: error instanceof Error ? error.message : String(error),
    });

    return new Response(
      JSON.stringify({ error: "kiosk_upstream_unavailable" }),
      {
        status: 502,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
