const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  },
});

async function probe(url) {
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

export async function onRequestGet() {
  const [external, supabase] = await Promise.all([
    probe("https://example.com/"),
    probe("https://xqepbqnaenoeyfjkjnzl.supabase.co/auth/v1/health"),
  ]);
  return json({ ok: true, version: 1, external, supabase });
}

export function onRequest() {
  return json({ error: "method_not_allowed" }, 405);
}
