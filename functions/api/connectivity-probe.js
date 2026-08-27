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

async function probeRecover() {
  const started = Date.now();
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
      method: "POST",
      redirect: "manual",
      headers: {
        apikey: PUBLIC_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: "nobody@example.invalid" }),
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
  const [external, supabase, recover] = await Promise.all([
    probeGet("https://example.com/"),
    probeGet(`${SUPABASE_URL}/auth/v1/health`),
    probeRecover(),
  ]);
  return json({ ok: true, version: 2, external, supabase, recover });
}

export function onRequest() {
  return json({ error: "method_not_allowed" }, 405);
}
