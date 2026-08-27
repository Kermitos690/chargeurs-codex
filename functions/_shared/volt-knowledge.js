import { VOLT_KNOWLEDGE, VOLT_KNOWLEDGE_META } from "../_generated/volt-knowledge.generated.js";

const STOP = new Set([
  "alors","avec","avoir","cette","comme","dans","des","elle","elles","est","et","faire","fait","il","ils","je","la","le","les","leur","lui","mais","mes","mon","ne","nous","on","ou","par","pas","pour","qu","que","qui","se","ses","son","sur","tu","un","une","vous","votre","vos",
  "the","and","for","from","that","this","with","you","your","are","was","were","have","has","not","but","can","will",
]);

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function tokens(value) {
  return normalize(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !STOP.has(token));
}

function scoreChunk(chunk, queryTokens, queryText) {
  const haystack = normalize(`${chunk.source} ${chunk.content}`);
  let score = 0;
  const unique = new Set(queryTokens);
  for (const token of unique) {
    if (haystack.includes(token)) score += token.length >= 7 ? 4 : 2;
    if (normalize(chunk.source).includes(token)) score += 2;
  }
  const phrases = queryText.match(/[a-z0-9]{4,}(?:\s+[a-z0-9]{3,}){1,3}/g) ?? [];
  for (const phrase of phrases.slice(0, 8)) if (haystack.includes(phrase)) score += 5;
  return score;
}

export function retrieveVoltKnowledge(query, limit = 6) {
  const normalizedQuery = normalize(query);
  const queryTokens = tokens(normalizedQuery);
  if (!queryTokens.length || !Array.isArray(VOLT_KNOWLEDGE)) return [];
  return VOLT_KNOWLEDGE
    .map((chunk) => ({ ...chunk, score: scoreChunk(chunk, queryTokens, normalizedQuery) }))
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score || a.source.localeCompare(b.source))
    .slice(0, Math.max(1, Math.min(10, limit)));
}

export function voltKnowledgeMeta() {
  return {
    generatedAt: VOLT_KNOWLEDGE_META?.generatedAt ?? null,
    sourceCount: Array.isArray(VOLT_KNOWLEDGE_META?.sources) ? VOLT_KNOWLEDGE_META.sources.length : 0,
    chunkCount: Array.isArray(VOLT_KNOWLEDGE) ? VOLT_KNOWLEDGE.length : 0,
  };
}
