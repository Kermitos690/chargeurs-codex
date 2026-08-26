import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const TERMS_VERSION = "terms-2026-08-26-preproduction-v2";
const PRIVACY_VERSION = "privacy-2026-08-26-preproduction-v2";
const headers = {
  ...corsHeaders,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-kiosk-token",
};
const admin = () => createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

async function sha256(input: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(bytes)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const rentalSessionId = typeof body.rentalSessionId === "string" ? body.rentalSessionId : "";
    const accepted = body.accepted === true;
    const surface = body.acceptanceSurface === "kiosk" ? "kiosk" : "";
    const language = body.language === "de" || body.language === "en" ? body.language : "fr";
    if (!rentalSessionId || !accepted || surface !== "kiosk") {
      return json({ ok: false, error: "CONTRACT_ACCEPTANCE_REQUIRED" }, 400);
    }

    const db = admin();
    const { data: session, error: sessionError } = await db.from("rental_sessions")
      .select("id,station_id,kiosk_device_id,state,expires_at")
      .eq("id", rentalSessionId).maybeSingle();
    if (sessionError) throw sessionError;
    if (!session) return json({ ok: false, error: "SESSION_NOT_FOUND" }, 404);
    if (session.expires_at && Date.parse(session.expires_at) < Date.now()) return json({ ok: false, error: "SESSION_EXPIRED" }, 410);
    if (!["created", "checkout_created"].includes(String(session.state))) return json({ ok: false, error: "SESSION_NOT_ACCEPTING_CONTRACT" }, 409);

    const token = (req.headers.get("X-Kiosk-Token") ?? "").trim();
    if (token.length < 24) return json({ ok: false, error: "KIOSK_AUTH_INVALID" }, 401);
    const { data: kiosk } = await db.from("kiosk_devices")
      .select("id,station_id,active,token_revoked,token_expires_at")
      .eq("token_hash", await sha256(token)).maybeSingle();
    if (!kiosk || kiosk.station_id !== session.station_id || String(kiosk.id) !== String(session.kiosk_device_id) || !kiosk.active || kiosk.token_revoked || (kiosk.token_expires_at && Date.parse(kiosk.token_expires_at) < Date.now())) {
      return json({ ok: false, error: "KIOSK_AUTH_INVALID" }, 401);
    }

    const acceptedAt = new Date().toISOString();
    const { error: updateError } = await db.from("rental_sessions").update({
      contract_terms_version: TERMS_VERSION,
      contract_privacy_version: PRIVACY_VERSION,
      contract_accepted_at: acceptedAt,
      updated_at: acceptedAt,
    }).eq("id", rentalSessionId);
    if (updateError) throw updateError;
    await db.from("audit_logs").insert({
      action: "rental.contract.accepted",
      target: rentalSessionId,
      data: { terms_version: TERMS_VERSION, privacy_version: PRIVACY_VERSION, surface, language },
    }).then(() => {}, () => {});
    return json({ ok: true, termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, acceptedAt });
  } catch (error) {
    console.error("record-rental-contract-acceptance", error instanceof Error ? error.message : "UNKNOWN_ERROR");
    return json({ ok: false, error: "CONTRACT_ACCEPTANCE_UNAVAILABLE" }, 500);
  }
});
