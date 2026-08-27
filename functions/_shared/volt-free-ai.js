const PROVIDERS = [
  {
    provider: "groq",
    keyName: "GROQ_API_KEY",
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    model: "llama-3.3-70b-versatile",
  },
  {
    provider: "openrouter",
    keyName: "OPENROUTER_API_KEY",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    // OpenRouter's free router only selects zero-cost models.
    model: "openrouter/free",
  },
  {
    provider: "gemini",
    keyName: "GOOGLE_AI_API_KEY",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    model: "gemini-2.5-flash",
  },
  {
    provider: "mistral",
    keyName: "MISTRAL_API_KEY",
    endpoint: "https://api.mistral.ai/v1/chat/completions",
    model: "mistral-small-latest",
  },
];

function extractText(data) {
  const candidates = [
    data?.choices?.[0]?.message?.content,
    data?.response,
    data?.text,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

async function fetchWithTimeout(url, init, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function callVoltFreeAI(env, messages) {
  if (!env) return null;

  const failures = [];
  let configured = 0;

  for (const target of PROVIDERS) {
    const key = typeof env[target.keyName] === "string" ? env[target.keyName].trim() : "";
    if (!key) continue;
    configured += 1;

    const headers = {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    };
    if (target.provider === "openrouter") {
      headers["HTTP-Referer"] = "https://chargeurs-ch-staging-cf.pages.dev";
      headers["X-Title"] = "Chargeurs.ch Volt";
    }

    try {
      const response = await fetchWithTimeout(target.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: target.model,
          messages,
          stream: false,
          temperature: 0.25,
          max_tokens: 500,
        }),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        failures.push(`${target.provider}/${target.model}: ${response.status} ${text.slice(0, 120)}`);
        continue;
      }

      const data = await response.json().catch(() => null);
      const reply = extractText(data).slice(0, 1800);
      if (!reply) {
        failures.push(`${target.provider}/${target.model}: empty response`);
        continue;
      }

      console.log(`[volt-free-ai] provider=${target.provider} model=${target.model}`);
      return {
        reply,
        provider: target.provider,
        model: target.model,
      };
    } catch (error) {
      failures.push(`${target.provider}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (configured > 0) {
    console.warn("[volt-free-ai] all configured providers failed", failures);
  }
  return null;
}
