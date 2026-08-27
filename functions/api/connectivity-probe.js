const SUPABASE_URL = "https://xqepbqnaenoeyfjkjnzl.supabase.co";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhxZXBicW5hZW5vZXlmamtqbnpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ0NjU3MDcsImV4cCI6MjEwMDA0MTcwN30.ds9MLO16LeljHdDuzLw1eoWaf5Kk393kMUshKlQJzu4";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  },
});

async function request(url, init = {}) {
  const started = Date.now();
  try {
    const response = await fetch(url, { redirect: "manual", ...init });
    const text = await response.text();
    let body = text;
    try { body = text ? JSON.parse(text) : null; } catch {}
    return {
      ok: true,
      status: response.status,
      contentType: response.headers.get("content-type") || null,
      elapsedMs: Date.now() - started,
      body,
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
  const publicHeaders = {
    apikey: ANON_KEY,
    Authorization: `Bearer ${ANON_KEY}`,
  };

  const [external, authHealth, invalidLogin, rest] = await Promise.all([
    request("https://example.com/"),
    request(`${SUPABASE_URL}/auth/v1/health`, { headers: { apikey: ANON_KEY } }),
    request(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { ...publicHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ email: "cloudflare-probe@example.invalid", password: "not-a-real-password" }),
    }),
    request(`${SUPABASE_URL}/rest/v1/user_roles?select=role&limit=1`, { headers: publicHeaders }),
  ]);

  const healthy = external.status === 200
    && authHealth.status === 200
    && invalidLogin.status === 400
    && rest.status === 200;

  return json({ ok: healthy, version: 4, external, authHealth, invalidLogin, rest }, healthy ? 200 : 502);
}

export function onRequest() {
  return json({ error: "method_not_allowed" }, 405);
}
