// Create a short-lived account-pairing QR for one authenticated kiosk.
// This function performs no payment or hardware action.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, auditLog, verifyKioskDevice } from "../_shared/db.ts";
import {
  CUSTOMER_PAIRING_TTL_SECONDS,
  createCustomerPairingToken,
  pairingTokenHash,
} from "../_shared/customerPairing.ts";

const headers = {
  ...corsHeaders,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-kiosk-token",
  "Access-Control-Expose-Headers": "x-correlation-id",
};

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
    if (!/^[A-Za-z0-9_-]{4,32}$/.test(stationId)) {
      return reply({ ok: false, error: "INVALID_STATION" }, 400);
    }

    const db = adminClient();
    const kiosk = await verifyKioskDevice(req, db, stationId);
    if (!kiosk.ok) return reply({ ok: false, error: kiosk.error }, kiosk.status);

    // Explicitly starting a new pairing invalidates any previous unconsumed QR
    // for this tablet. The customer can therefore never claim an old screen.
    const now = new Date().toISOString();
    await db.from("customer_pairing_sessions").update({
      state: "cancelled", cancelled_at: now, updated_at: now,
    }).eq("kiosk_device_id", kiosk.device.id).in("state", ["pending", "claimed"]);

    const token = createCustomerPairingToken();
    const tokenHash = await pairingTokenHash(token);
    const expiresAt = new Date(Date.now() + CUSTOMER_PAIRING_TTL_SECONDS * 1000).toISOString();
    const { data: pairing, error } = await db.from("customer_pairing_sessions").insert({
      token_hash: tokenHash,
      station_id: stationId,
      kiosk_device_id: kiosk.device.id,
      state: "pending",
      segment: "member",
      expires_at: expiresAt,
    }).select("id,expires_at").single();
    if (error) throw error;

    await auditLog(db, {
      action: "customer.pairing.created",
      target: pairing.id,
      data: {
        station_id: stationId,
        kiosk_device_id: kiosk.device.id,
        token_fp: tokenHash.slice(0, 12),
        expires_at: pairing.expires_at,
        correlation_id: correlationId,
      },
    });

    // The raw token is returned exactly once and is only encoded in the QR.
    // It is never written to a database/log.
    return reply({
      ok: true,
      pairingId: pairing.id,
      token,
      expiresAt: pairing.expires_at,
      connectPath: `/compte/connect/${token}`,
    });
  } catch (error) {
    console.error("customer-pairing-create", error instanceof Error ? error.message : "UNKNOWN_ERROR");
    return reply({ ok: false, error: "PAIRING_CREATE_FAILED" }, 500);
  }
});
