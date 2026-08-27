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

function classifyGroqStatus(status) {
  if (status === 400) return "bad_request";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "model_not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "provider_error";
  return status >= 200 && status < 300 ? "ready" : "unexpected";
}

async function probeGroq(env) {
  const key = typeof env?.GROQ_API_KEY === "string" ? env.GROQ_API_KEY.trim() : "";
  if (!key) return { configured: false, ok: false, state: "missing_secret" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "qwen/qwen3.6-27b",
        messages: [{ role: "user", content: "Réponds uniquement: OK" }],
        stream: false,
        temperature: 0,
        max_tokens: 8,
        reasoning_effort: "none",
      }),
    });
    return {
      configured: true,
      ok: response.ok,
      httpStatus: response.status,
      state: classifyGroqStatus(response.status),
      model: "qwen/qwen3.6-27b",
    };
  } catch (error) {
    return {
      configured: true,
      ok: false,
      state: error instanceof Error && error.name === "AbortError" ? "timeout" : "network_error",
      model: "qwen/qwen3.6-27b",
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function onRequest(context) {
  if (context.request.method.toUpperCase() !== "GET") return json({ ok: false }, 405);
  if (!isCloudflareProjectHost(context.request)) return json({ ok: false }, 403);

  const env = context.env ?? {};
  const providers = {
    groq: Boolean(typeof env.GROQ_API_KEY === "string" && env.GROQ_API_KEY.trim()),
    openrouter: Boolean(typeof env.OPENROUTER_API_KEY === "string" && env.OPENROUTER_API_KEY.trim()),
    gemini: Boolean(typeof env.GOOGLE_AI_API_KEY === "string" && env.GOOGLE_AI_API_KEY.trim()),
    mistral: Boolean(typeof env.MISTRAL_API_KEY === "string" && env.MISTRAL_API_KEY.trim()),
  };

  return json({
    ok: true,
    providers,
    workersAIReady: Boolean(env.AI && typeof env.AI.run === "function"),
    groq: await probeGroq(env),
  });
}
