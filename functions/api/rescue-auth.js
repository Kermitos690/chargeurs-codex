const SUPABASE_URL = "https://xqepbqnaenoeyfjkjnzl.supabase.co";
const PUBLIC_KEY = "sb_publishable_39LXZ2QrezT20u9dqDQX2Q_-yq4GX0d";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  },
});

async function relay(url, init) {
  try {
    const response = await fetch(url, init);
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; }
    catch { data = { raw: text }; }
    return json(data, response.status);
  } catch (error) {
    return json({ error: "upstream_unreachable", message: error instanceof Error ? error.message : "Upstream unreachable" }, 502);
  }
}

async function probe(url) {
  try {
    const response = await fetch(url, { method: "GET", redirect: "manual" });
    return {
      ok: true,
      status: response.status,
      contentType: response.headers.get("content-type") || null,
      location: response.headers.get("location") || null,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : null,
    };
  }
}

export async function onRequestPost(context) {
  let body;
  try { body = await context.request.json(); }
  catch { return json({ error: "invalid_json" }, 400); }

  const action = typeof body?.action === "string" ? body.action : "";
  const auth = context.request.headers.get("Authorization") || "";
  const baseHeaders = {
    apikey: PUBLIC_KEY,
    "Content-Type": "application/json",
  };

  if (action === "ping") return json({ ok: true, bridge: "cloudflare" });

  if (action === "login") {
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (!email || !password) return json({ error: "email_and_password_required" }, 400);
    return relay(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: baseHeaders,
      body: JSON.stringify({ email, password }),
    });
  }

  if (action === "recover") {
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email) return json({ error: "email_required" }, 400);
    const redirectTo = new URL("/rescue-admin-v2.html", context.request.url).toString();
    return relay(`${SUPABASE_URL}/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`, {
      method: "POST",
      headers: baseHeaders,
      body: JSON.stringify({ email }),
    });
  }

  if (action === "updatePassword") {
    const password = typeof body?.password === "string" ? body.password : "";
    if (!auth.startsWith("Bearer ") || password.length < 8) return json({ error: "valid_recovery_token_and_password_required" }, 400);
    return relay(`${SUPABASE_URL}/auth/v1/user`, {
      method: "PUT",
      headers: { ...baseHeaders, Authorization: auth },
      body: JSON.stringify({ password }),
    });
  }

  if (action === "c2") {
    if (!auth.startsWith("Bearer ")) return json({ error: "authentication_required" }, 401);
    const dryRun = body?.dryRun === true;
    const payload = {
      action: "invoke",
      code: "C2",
      params: { cabinetid: "DTA22032", slotNum: 2 },
      dryRun,
      maintenanceMode: true,
      confirm: !dryRun,
      confirmation: "EXECUTER C2 DTA22032 SLOT 2",
    };
    return relay(`${SUPABASE_URL}/functions/v1/chargenow-admin`, {
      method: "POST",
      headers: { ...baseHeaders, Authorization: auth },
      body: JSON.stringify(payload),
    });
  }

  return json({ error: "unsupported_action" }, 400);
}

export async function onRequest(context) {
  if (context.request.method === "GET") {
    const url = new URL(context.request.url);
    const target = url.searchParams.get("probe");
    if (target === "external") return json({ target, result: await probe("https://example.com/") });
    if (target === "supabase") return json({ target, result: await probe(`${SUPABASE_URL}/auth/v1/health`) });
    return json({ ok: true, bridge: "cloudflare", version: 3 });
  }
  if (context.request.method === "POST") return onRequestPost(context);
  return json({ error: "method_not_allowed" }, 405);
}
