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

async function probeGet(url) {
  const started = Date.now();
  try {
    const response = await fetch(url, { method: "GET", redirect: "manual" });
    return {
      ok: true,
      status: response.status,
      contentType: response.headers.get("content-type") || null,
      location: response.headers.get("location") || null,
      elapsedMs: Date.now() - started,
    };
  } catch (error) {
    return {
      ok: false,
      name: error instanceof Error ? error.name : null,
      error: error instanceof Error ? error.message : String(error),
      elapsedMs: Date.now() - started,
    };
  }
}

async function probePost(url, body, headers = {}) {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    return {
      ok: true,
      status: response.status,
      contentType: response.headers.get("content-type") || null,
      location: response.headers.get("location") || null,
      elapsedMs: Date.now() - started,
    };
  } catch (error) {
    return {
      ok: false,
      name: error instanceof Error ? error.name : null,
      error: error instanceof Error ? error.message : String(error),
      elapsedMs: Date.now() - started,
    };
  }
}

export async function onRequestGet() {
  const [external, supabase, recover, edgeFunction] = await Promise.all([
    probeGet("https://example.com/"),
    probeGet(`${SUPABASE_URL}/auth/v1/health`),
    probePost(`${SUPABASE_URL}/auth/v1/recover`, { email: "nobody@example.invalid" }, { apikey: PUBLIC_KEY }),
    probePost(`${SUPABASE_URL}/functions/v1/chargenow-admin`, {}, { apikey: PUBLIC_KEY }),
  ]);
  return json({ ok: true, version: 3, external, supabase, recover, edgeFunction });
}

export function onRequest() {
  return json({ error: "method_not_allowed" }, 405);
}
