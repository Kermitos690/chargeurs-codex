// Kiosk-safe polling for account pairing. No email, auth token or user UUID is
// returned to the public screen; only a display first name and segment.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, verifyKioskDevice } from "../_shared/db.ts";

const headers = {
  ...corsHeaders,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-kiosk-token",
  "Access-Control-Expose-Headers": "x-correlation-id",
};

function safeFirstName(value: unknown): string {
  if (typeof value !== "string") return "Client";
  const trimmed = value.trim().replace(/[<>]/g, "").slice(0, 80);
  if (!trimmed) return "Client";
  return trimmed.split(/\s+/)[0].slice(0, 32);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  const correlationId = crypto.randomUUID();
  const reply = (body: Record<string, unknown>, status = 200) => new Response(
    JSON.stringify({ ...body, correlationId }),
    { status, headers: { ...headers, "Content-Type": "application/json", "X-Correlation-Id": correlationId } },
  );
  if (req.method !== "POST") return reply({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const stationId = typeof body.stationId === "string" ? body.stationId.trim() : "";
    const pairingId = typeof body.pairingId === "string" ? body.pairingId.trim() : "";
    if (!/^[A-Za-z0-9_-]{4,32}$/.test(stationId) || !/^[0-9a-f-]{36}$/i.test(pairingId)) {
      return reply({ ok: false, error: "PAIRING_STATUS_INVALID" }, 400);
    }

    const db = adminClient();
    const kiosk = await verifyKioskDevice(req, db, stationId);
    if (!kiosk.ok) return reply({ ok: false, error: kiosk.error }, kiosk.status);

    const { data: pairing, error } = await db.from("customer_pairing_sessions")
      .select("id,station_id,kiosk_device_id,customer_user_id,state,segment,expires_at,claimed_at,consumed_at")
      .eq("id", pairingId)
      .eq("station_id", stationId)
      .eq("kiosk_device_id", kiosk.device.id)
      .maybeSingle();
    if (error) throw error;
    if (!pairing) return reply({ ok: false, error: "PAIRING_NOT_FOUND" }, 404);

    if (Date.parse(pairing.expires_at) <= Date.now() && pairing.state === "pending") {
      await db.from("customer_pairing_sessions").update({ state: "expired", updated_at: new Date().toISOString() }).eq("id", pairing.id);
      return reply({ ok: true, state: "expired", connected: false, expiresAt: pairing.expires_at });
    }

    if (!["claimed", "consumed"].includes(pairing.state) || !pairing.customer_user_id) {
      return reply({ ok: true, state: pairing.state, connected: false, expiresAt: pairing.expires_at });
    }

    const { data: profile } = await db.from("profiles")
      .select("display_name,preferred_language")
      .eq("id", pairing.customer_user_id)
      .maybeSingle();

    return reply({
      ok: true,
      state: pairing.state,
      connected: true,
      displayName: safeFirstName(profile?.display_name),
      preferredLanguage: profile?.preferred_language ?? null,
      segment: pairing.segment,
      expiresAt: pairing.expires_at,
    });
  } catch (error) {
    console.error("customer-pairing-status", error instanceof Error ? error.message : "UNKNOWN_ERROR");
    return reply({ ok: false, error: "PAIRING_STATUS_FAILED" }, 500);
  }
});
