import { callVoltFreeAI } from "../_shared/volt-free-ai.js";
import { retrieveVoltKnowledge } from "../_shared/volt-knowledge.js";

const MAX_HISTORY = 10;
const MAX_TEXT = 1200;
const KNOWLEDGE_LIMIT = 8;

function cleanText(value, max = MAX_TEXT) {
  return typeof value === "string" ? value.replace(/\u0000/g, "").trim().slice(0, max) : "";
}

function normalizeHistory(value) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(-MAX_HISTORY)
    .map((item) => ({
      role: item?.role === "assistant" || item?.role === "volt" ? "assistant" : "user",
      content: cleanText(item?.content ?? item?.text),
    }))
    .filter((item) => item.content);
}

function systemPrompt({ locale, mode, contextHint, chunks }) {
  const knowledge = chunks.length
    ? chunks.map((chunk, index) => `[Source ${index + 1}]\n${chunk.content}`).join("\n\n---\n\n")
    : "Aucune source Chargeurs.ch pertinente n’a été retrouvée.";

  return `Tu es Volt, l’assistant client de Chargeurs.ch, service suisse de location de powerbanks.

Réponds dans la langue du client (${locale || "fr"}) avec un ton naturel, utile et bref. Comprends la conversation entière et le message courant, qui prime sur les anciens sujets. Réponds à la vraie intention au lieu de réciter une FAQ.

Utilise uniquement les sources Chargeurs.ch ci-dessous pour les faits produit. Synthétise-les dans tes propres mots. Ne cite jamais du code, un nom de fichier ou un objet technique. N’invente aucun tarif, état de paiement, solde, retour, disponibilité de borne ou statut de compte. Un contexte d’interface n’est pas une preuve d’état réel. Ne révèle aucun secret, token, procédure interne ou commande matérielle. Ne prétends jamais avoir exécuté une action. Pour un incident, explique ce qui est possible puis laisse le code déterministe décider de l’escalade support.

Réponds uniquement avec la réponse finale destinée au client, sans exposer de raisonnement interne.

Mode d’interface: ${mode || "public"}
Contexte client non vérifié: ${contextHint || "non fourni"}

SOURCES CHARGEURS.CH:
${knowledge}`;
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (url.pathname !== "/api/volt-chat" || context.request.method.toUpperCase() !== "POST") {
    return context.next();
  }

  const requestCopy = context.request.clone();
  const baseResponse = await context.next();

  let baseData;
  try {
    baseData = await baseResponse.clone().json();
  } catch {
    return baseResponse;
  }

  // Keep local small-talk, a working Workers AI response, and all errors untouched.
  if (!baseResponse.ok || baseData?.provider !== "knowledge-fallback") {
    return baseResponse;
  }

  let body;
  try {
    body = await requestCopy.json();
  } catch {
    return baseResponse;
  }

  const message = cleanText(body?.message);
  if (!message) return baseResponse;

  const history = normalizeHistory(body?.history);
  const mode = body?.mode === "client" ? "client" : "public";
  const locale = cleanText(body?.locale, 12) || "fr";
  const contextHint = mode === "client" ? cleanText(body?.contextHint, 700) : "";
  const query = [...history.slice(-6).map((item) => item.content), message, contextHint]
    .filter(Boolean)
    .join("\n");
  const chunks = retrieveVoltKnowledge(query, KNOWLEDGE_LIMIT);

  const messages = [
    { role: "system", content: systemPrompt({ locale, mode, contextHint, chunks }) },
    ...history,
    { role: "user", content: message },
  ];

  const freeResult = await callVoltFreeAI(context.env, messages);
  if (!freeResult) return baseResponse;

  const headers = new Headers(baseResponse.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");

  return new Response(JSON.stringify({
    ...baseData,
    reply: freeResult.reply,
    provider: freeResult.provider,
    model: freeResult.model,
    aiReady: true,
    aiState: "free-provider-ready",
  }), {
    status: 200,
    headers,
  });
}
