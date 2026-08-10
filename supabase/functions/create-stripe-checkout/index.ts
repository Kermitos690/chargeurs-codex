// Kiosk payment launcher. It returns the branded Chargeurs mobile route.
// The phone, never the kiosk, selects card-hold versus TWINT prepaid semantics.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const headers = {
  ...corsHeaders,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-kiosk-token, x-idempotency-key",
  "Access-Control-Expose-Headers": "x-correlation-id",
};

const admin = () => createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

async function sha256(input: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function auth(req: Request, db: any, stationId: string) {
  const token = (req.headers.get("X-Kiosk-Token") ?? "").trim();
  if (token.length < 24) return null;
  const hash = await sha256(token);
  const { data } = await db.from("kiosk_devices")
    .select("id,station_id,active,token_revoked,token_expires_at")
    .eq("token_hash", hash)
    .maybeSingle();
  if (!data || data.station_id !== stationId || !data.active || data.token_revoked) return null;
  if (data.token_expires_at && Date.parse(data.token_expires_at) < Date.now()) return null;
  return data;
}

function safePublicOrigin(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    // Never put a raw Supabase Edge Function hostname in the customer QR.
    if (url.hostname.endsWith(".supabase.co")) return null;
    return url.origin;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  const correlationId = crypto.randomUUID();
  const json = (body: Record<string, unknown>, status = 200) => new Response(
    JSON.stringify({ ...body, correlationId }),
    { status, headers: { ...headers, "Content-Type": "application/json", "X-Correlation-Id": correlationId } },
  );
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const id = typeof body.rentalSessionId === "string" ? body.rentalSessionId : "";
    if (!id) return json({ ok: false, error: "MISSING_SESSION" }, 400);

    const db = admin();
    const { data: session, error } = await db.from("rental_sessions")
      .select("id,station_id,kiosk_device_id,public_session_code,customer_language,expires_at,pricing_snapshot,deposit_amount_cents,paid_at")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!session) return json({ ok: false, error: "SESSION_NOT_FOUND" }, 404);

    const device = await auth(req, db, String(session.station_id ?? ""));
    if (!device) return json({ ok: false, error: "KIOSK_AUTH_INVALID" }, 401);
    if (String(session.kiosk_device_id ?? "") !== String(device.id)) return json({ ok: false, error: "KIOSK_DEVICE_MISMATCH" }, 403);
    if (session.expires_at && Date.parse(session.expires_at) < Date.now()) return json({ ok: false, error: "SESSION_EXPIRED" }, 410);
    if (session.paid_at) return json({ ok: false, error: "SESSION_ALREADY_PAID" }, 409);

    const lang = session.customer_language === "de" || session.customer_language === "en" ? session.customer_language : "fr";
    const requestedOrigin = safePublicOrigin(body.origin);
    const configuredOrigin = safePublicOrigin(Deno.env.get("PUBLIC_APP_URL"));
    const publicOrigin = requestedOrigin ?? configuredOrigin;
    if (!publicOrigin) return json({ ok: false, error: "PUBLIC_APP_URL_NOT_CONFIGURED" }, 503);

    const expiresAt = session.expires_at ?? new Date(Date.now() + 20 * 60_000).toISOString();
    const publicCode = String(session.public_session_code ?? "");
    const launch = `${publicOrigin}/pay/${encodeURIComponent(String(session.id))}/choose?c=${encodeURIComponent(publicCode)}&lang=${lang}`;

    await db.from("rental_sessions").update({
      checkout_url: launch,
      checkout_url_expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    }).eq("id", session.id);

    return json({
      ok: true,
      checkout_url: launch,
      public_session_code: session.public_session_code,
      expires_at: expiresAt,
      status: "awaiting_payment_choice",
      deposit_cents: Number(session.deposit_amount_cents ?? (session.pricing_snapshot as any)?.deposit_cents ?? 0),
    });
  } catch (error) {
    console.error("create-stripe-checkout launcher", error instanceof Error ? error.message : "UNKNOWN");
    return json({ ok: false, error: "PAYMENT_LAUNCH_FAILED" }, 500);
  }
});
