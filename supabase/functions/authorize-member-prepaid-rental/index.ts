// Authorize a v3 member rental from already-paid Chargeurs.ch credit.
// No Stripe object is created. The database RPC atomically claims the prepaid
// rail, reserves CHF 30.00 and advances the Rental Orchestrator to authorized.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, auditLog, verifyKioskDevice } from "../_shared/db.ts";

const headers = {
  ...corsHeaders,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-kiosk-token",
  "Access-Control-Expose-Headers": "x-correlation-id",
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function triggerEjection(rentalSessionId: string) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRole) return { ok: false, status: 0, error: "SUPABASE_INTERNAL_CONFIG_MISSING" };
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/eject-after-payment`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceRole}`,
      },
      body: JSON.stringify({ rentalSessionId }),
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    return {
      ok: response.ok,
      status: response.status,
      error: typeof payload.error === "string" ? payload.error : null,
    };
  } catch {
    return { ok: false, status: 0, error: "EJECT_TRIGGER_UNAVAILABLE" };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  const correlationId = crypto.randomUUID();
  const reply = (body: Record<string, unknown>, status = 200) => new Response(
    JSON.stringify({ ...body, correlationId }),
    {
      status,
      headers: {
        ...headers,
        "Content-Type": "application/json",
        "X-Correlation-Id": correlationId,
      },
    },
  );
  if (req.method !== "POST") return reply({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const rentalSessionId = typeof body.rentalSessionId === "string" ? body.rentalSessionId.trim() : "";
    if (!uuid.test(rentalSessionId)) return reply({ ok: false, error: "INVALID_RENTAL_ID" }, 400);

    const db = adminClient();
    const { data: session, error: sessionError } = await db.from("rental_sessions")
      .select("id,station_id,kiosk_device_id,customer_segment,settlement_strategy,settlement_status,state")
      .eq("id", rentalSessionId)
      .maybeSingle();
    if (sessionError) throw sessionError;
    if (!session) return reply({ ok: false, error: "SESSION_NOT_FOUND" }, 404);

    const stationId = String(session.station_id ?? "");
    const kiosk = await verifyKioskDevice(req, db, stationId);
    if (!kiosk.ok) return reply({ ok: false, error: kiosk.error }, kiosk.status);
    if (String(kiosk.device.id) !== String(session.kiosk_device_id ?? "")) {
      return reply({ ok: false, error: "KIOSK_DEVICE_MISMATCH" }, 403);
    }

    if (session.customer_segment !== "member") {
      return reply({ ok: true, eligible: false, authorized: false, reason: "NOT_MEMBER" });
    }

    const { data, error } = await db.rpc("authorize_member_prepaid_rental", {
      p_rental_id: rentalSessionId,
      p_kiosk_device_id: kiosk.device.id,
      p_correlation_id: correlationId,
    });
    if (error) {
      const message = String(error.message ?? "");
      if (message.includes("PAYMENT_RAIL_ALREADY_CLAIMED")) {
        return reply({ ok: false, error: "PAYMENT_RAIL_ALREADY_CLAIMED" }, 409);
      }
      if (message.includes("CONTRACT_ACCEPTANCE_REQUIRED")) {
        return reply({ ok: false, error: "CONTRACT_ACCEPTANCE_REQUIRED" }, 409);
      }
      if (message.includes("MEMBER_PREPAID_V3_SNAPSHOT_REQUIRED")) {
        return reply({ ok: false, error: "MEMBER_PREPAID_V3_SNAPSHOT_REQUIRED" }, 409);
      }
      throw error;
    }

    const result = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
    const authorized = result?.authorized === true;
    const reason = String(result?.reason ?? (authorized ? "AUTHORIZED" : "PREPAID_NOT_AVAILABLE"));
    const reservedCents = Number(result?.reserved_cents ?? 0);

    if (!authorized) {
      await auditLog(db, {
        action: "membership_prepaid.rental_not_authorized",
        target: rentalSessionId,
        data: { reason, reserved_cents: reservedCents, correlation_id: correlationId },
      });
      return reply({
        ok: true,
        eligible: reason !== "NOT_MEMBER",
        authorized: false,
        reason,
        reservedCents: 0,
        currency: "CHF",
      });
    }

    const ejection = await triggerEjection(rentalSessionId);
    await auditLog(db, {
      action: "membership_prepaid.kiosk_authorized",
      target: rentalSessionId,
      data: {
        reserved_cents: reservedCents,
        currency: "CHF",
        ejection_trigger_ok: ejection.ok,
        ejection_trigger_status: ejection.status,
        ejection_trigger_error: ejection.error,
        correlation_id: correlationId,
      },
    });

    // Financial authorization remains valid if the hardware trigger is delayed
    // or fails. Existing reconciliation must resolve the physical side; never
    // silently release/re-spend the same CHF 30 reservation after an uncertain
    // post-authorization hardware result.
    return reply({
      ok: true,
      eligible: true,
      authorized: true,
      idempotent: reason === "ALREADY_AUTHORIZED",
      reason,
      reservedCents,
      currency: "CHF",
      paymentRail: "PREPAID",
      settlementStatus: "prepaid",
      ejectionTriggered: ejection.ok,
      ejectionTriggerStatus: ejection.status,
      ejectionTriggerError: ejection.error,
    }, ejection.ok ? 200 : 202);
  } catch (error) {
    console.error("authorize-member-prepaid-rental", error instanceof Error ? error.message : "UNKNOWN_ERROR");
    return reply({ ok: false, error: "MEMBER_PREPAID_AUTHORIZATION_FAILED" }, 500);
  }
});
