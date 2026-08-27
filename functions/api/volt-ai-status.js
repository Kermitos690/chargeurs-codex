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
  if (context.request.method.toUpperCase() !== "GET") return json({ ok: false }, 405);
  if (!isCloudflareProjectHost(context.request)) return json({ ok: false }, 403);

  const env = context.env ?? {};
  const freeProviderReady = [
    "GROQ_API_KEY",
    "OPENROUTER_API_KEY",
    "GOOGLE_AI_API_KEY",
    "MISTRAL_API_KEY",
  ].some((key) => typeof env[key] === "string" && env[key].trim().length > 0);

  return json({
    ok: true,
    freeProviderReady,
    workersAIReady: Boolean(env.AI && typeof env.AI.run === "function"),
  });
}
