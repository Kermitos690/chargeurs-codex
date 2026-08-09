// Claim a kiosk pairing from the authenticated Chargeurs customer account.
// verify_jwt must remain enabled on deployment; the function also validates the
// JWT server-side and requires a confirmed email before exposing member pricing.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, auditLog } from "../_shared/db.ts";
import { pairingTokenHash, validPairingToken } from "../_shared/customerPairing.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const correlationId = crypto.randomUUID();
  const reply = (body: Record<string, unknown>, status = 200) => new Response(
    JSON.stringify({ ...body, correlationId }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json", "X-Correlation-Id": correlationId } },
  );
  if (req.method !== "POST") return reply({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  try {
    const authorization = req.headers.get("Authorization") ?? "";
    const jwt = authorization.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) return reply({ ok: false, error: "AUTH_REQUIRED" }, 401);

    const db = adminClient();
    const { data: userData, error: userError } = await db.auth.getUser(jwt);
    const user = userData.user;
    if (userError || !user) return reply({ ok: false, error: "AUTH_INVALID" }, 401);
    if (!user.email_confirmed_at) return reply({ ok: false, error: "EMAIL_CONFIRMATION_REQUIRED" }, 403);

    const body = await req.json().catch(() => ({}));
    const token = body.token;
    if (!validPairingToken(token)) return reply({ ok: false, error: "PAIRING_TOKEN_INVALID" }, 400);
    const tokenHash = await pairingTokenHash(token);

    const { data: current, error: readError } = await db.from("customer_pairing_sessions")
      .select("id,station_id,kiosk_device_id,customer_user_id,state,segment,expires_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();
    if (readError) throw readError;
    if (!current) return reply({ ok: false, error: "PAIRING_NOT_FOUND" }, 404);

    if (Date.parse(current.expires_at) <= Date.now()) {
      if (current.state === "pending") {
        await db.from("customer_pairing_sessions").update({ state: "expired", updated_at: new Date().toISOString() }).eq("id", current.id);
      }
      return reply({ ok: false, error: "PAIRING_EXPIRED" }, 410);
    }

    if (current.state === "claimed" && current.customer_user_id === user.id) {
      return reply({ ok: true, pairingId: current.id, stationId: current.station_id, segment: current.segment, idempotent: true });
    }
    if (current.state !== "pending") return reply({ ok: false, error: "PAIRING_NOT_CLAIMABLE" }, 409);

    // Atomic compare-and-set: only one account can win the QR.
    const now = new Date().toISOString();
    const { data: claimed, error: claimError } = await db.from("customer_pairing_sessions").update({
      customer_user_id: user.id,
      state: "claimed",
      claimed_at: now,
      updated_at: now,
    }).eq("id", current.id)
      .eq("state", "pending")
      .is("customer_user_id", null)
      .gt("expires_at", now)
      .select("id,station_id,segment")
      .maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) return reply({ ok: false, error: "PAIRING_ALREADY_CLAIMED" }, 409);

    await auditLog(db, {
      actor: user.id,
      action: "customer.pairing.claimed",
      target: claimed.id,
      data: {
        station_id: claimed.station_id,
        kiosk_device_id: current.kiosk_device_id,
        segment: claimed.segment,
        correlation_id: correlationId,
      },
    });

    return reply({ ok: true, pairingId: claimed.id, stationId: claimed.station_id, segment: claimed.segment });
  } catch (error) {
    console.error("customer-pairing-claim", error instanceof Error ? error.message : "UNKNOWN_ERROR");
    return reply({ ok: false, error: "PAIRING_CLAIM_FAILED" }, 500);
  }
});
